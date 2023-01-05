import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	prepareFuzzySearch,
	Setting,
	TFile,
} from "obsidian";

type SuggestionObject = {
	alias: string;
	path: string;
	originTFile: TFile;
	isAlias: boolean;
	extension: string;
	linkCount: number;
	linkCountDescription: string;
};

interface BoostLinkPluginSettings {
	triggerString: string;
	yamlFrontMatterBoostTag: string;
	showScores: boolean;
	apiVersion: number;
}

const DEFAULT_SETTINGS: BoostLinkPluginSettings = {
	triggerString: "b[",
	yamlFrontMatterBoostTag: 'boost',
	showScores: true,
	apiVersion: 1,
};

const getBoostedSuggestions = (
	plugin: BoostLinkPlugin,
	files: TFile[],
	filterString?: string
) => {
	const searchCallback = prepareFuzzySearch(filterString);

	const resolvedLinks = Object.values(plugin.app.metadataCache.resolvedLinks);
	const backlinkCounts = getBackLinkCounts(resolvedLinks);

	let boostlinksGathered = files
		.map((file) => {
			const frontMatter =
				plugin.app.metadataCache.getFileCache(file)?.frontmatter;

			const boost = (frontMatter?.boost && Number.isInteger(frontMatter.boost)) ? frontMatter.boost : 0;

			const linkCount = backlinkCounts[file.path] || 0;

			const finalLinkCount = linkCount + boost;

			let aliases = frontMatter?.alias || frontMatter?.aliases || [];

			if (!Array.isArray(aliases)) {
				aliases = aliases != null ? [aliases] : [];
			}

			aliases = aliases.filter(
				(a: String) => a
			);

			let output = [
				...(Array.isArray(aliases) ? aliases : [aliases]),
				file.basename,
			]
				.map((alias: string) => {
					if (alias === undefined || alias === null) {
						return null
					}

					const fuzzyMatchOutput = searchCallback(alias);

					if (!fuzzyMatchOutput) {
						return null
					}

					const finalMatchScore = (-1 * fuzzyMatchOutput.score) * finalLinkCount;

					return {
						alias: `${alias}`,
						matchScore: finalMatchScore,
						path: `${file.path}`,
						originTFile: file,
						isAlias: alias !== file.basename,
						extension: file.path.split(".").pop(),
						linkCount: finalLinkCount,
						linkCountDescription: `${Math.round(finalMatchScore * 100) / 100}: Search score of ${-1 * Math.round(fuzzyMatchOutput.score * 100) / 100}} * (${linkCount} links + ${boost ? 'boost of ' + boost : 'no boost'})`
					};

				})
				.flat();

			return output;
		})
		.filter((a) => a.length)
		.flat()
		.filter((r) => r !== undefined && r !== null)

	return boostlinksGathered.sort((a, b) => b.matchScore - a.matchScore);
};

const renderSuggestionObject = (
	suggestion: SuggestionObject,
	el: HTMLElement,
	showScores: boolean,
): void => {
	const suggesterEl = el.createDiv({ cls: "boostlink-suggester-el" });
	if (suggestion.isAlias) {
		const aliasEl = suggesterEl.createSpan();
		aliasEl.setText("⤿");
		aliasEl.addClass("boostlink-is-alias");
	}
	const suggestionTextEl = suggesterEl.createDiv({
		cls: "boostlink-suggestion-text",
	});
	suggestionTextEl
		.createDiv({ cls: "boostlink-alias" })
		.setText(suggestion.alias);
	suggestionTextEl
		.createDiv({ cls: "boostlink-item" })
		.setText(suggestion.path);
	if (showScores) {
		suggestionTextEl
			.createDiv({ cls: "boostlink-count" })
			.setText(`Score: ${suggestion.linkCountDescription}`);
	}
};

const getBackLinkCounts = (cachedLinkCounts: { [key: string]: number }[]) =>
	cachedLinkCounts.reduce((result, fileLinkCounts) => {
		for (const key in fileLinkCounts) {
			result[key] = (result[key] || 0) + fileLinkCounts[key];
		}
		return result;
	}, {});


export default class BoostLinkPlugin extends Plugin {
	settings: BoostLinkPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerEditorSuggest(
			new BoostLinkEditorSuggester(this, this.settings)
		);

		this.addCommand({
			id: "add-file-link",
			icon: "link",
			name: "Trigger link",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection(this.settings.triggerString);
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new BoostLinkSettingsTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const escapeRegExp = (str: string) => {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& = the whole matched string
};

class BoostLinkEditorSuggester extends EditorSuggest<{
	alias: string;
	path: string;
}> {
	plugin: BoostLinkPlugin;
	settings: BoostLinkPluginSettings;
	triggerString: string;

	constructor(plugin: BoostLinkPlugin, settings: BoostLinkPluginSettings) {
		super(plugin.app);
		this.plugin = plugin;
		this.settings = settings;
		this.triggerString = this.plugin.settings.triggerString;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const subString = line.substring(0, cursor.ch);
		const match = subString
			.match(new RegExp(escapeRegExp(this.triggerString)))
			?.first();

		const triggerStringClosingBrackets = this.triggerString
			.match(/\[{1,}$/)
			?.first();

		if (match) {
			return {
				start: {
					ch: subString.lastIndexOf(match),
					line: cursor.line,
				},
				end: {
					line: cursor.line,
					ch:
						triggerStringClosingBrackets &&
							editor.getLine(cursor.line).length > cursor.ch &&
							editor.getRange(cursor, {
								line: cursor.line,
								ch: cursor.ch + 1,
							}) === "]".repeat(triggerStringClosingBrackets.length)
							? cursor.ch + 1
							: cursor.ch,
				},
				query: subString.substring(
					subString.lastIndexOf(match) + this.triggerString.length,
					subString.length
				),
			};
		}
	}

	getSuggestions(context: EditorSuggestContext): SuggestionObject[] {
		return getBoostedSuggestions(
			this.plugin,
			this.plugin.app.vault.getFiles(),
			context.query
		);
	}

	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		renderSuggestionObject(suggestion, el, this.plugin.settings.showScores);
	}

	selectSuggestion(suggestion: SuggestionObject): void {
		if (this.context) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
				suggestion.path,
				suggestion.originTFile.path
			);
			if (file) {
				const markdownLink = this.plugin.app.fileManager
					.generateMarkdownLink(
						file,
						this.context.file.path,
						"",
						suggestion.alias
					)
					.replace(/^\!/, "");

				const editor: Editor = this.context.editor as Editor;
				editor.replaceRange(
					markdownLink,
					this.context.start,
					this.context.end
				);

				const { ch, line } = this.context.start;
				editor.setCursor({ line, ch: ch + markdownLink.length });
			}
		}
	}
}

class BoostLinkSettingsTab extends PluginSettingTab {
	plugin: BoostLinkPlugin;

	constructor(app: App, plugin: BoostLinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Boost Link Suggestions" });

		new Setting(containerEl)
			.setName("Trigger string")
			.setDesc(
				'The string to trigger suggestions. Changing this setting requires reloading Obsidian. Triggering may not work if this string conflicts with an existing trigger (e.g., "[[").'
			)
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.triggerString ||
						DEFAULT_SETTINGS.triggerString
					)
					.setPlaceholder(DEFAULT_SETTINGS.triggerString)
					.onChange(async (value) => {
						this.plugin.settings.triggerString =
							value || DEFAULT_SETTINGS.triggerString;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("YAML front-matter boost tag")
			.setDesc(
				'The YAML front-matter tag used to indicate link boost values.'
			)
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.yamlFrontMatterBoostTag ||
						DEFAULT_SETTINGS.yamlFrontMatterBoostTag
					)
					.setPlaceholder(DEFAULT_SETTINGS.yamlFrontMatterBoostTag)
					.onChange(async (value) => {
						this.plugin.settings.yamlFrontMatterBoostTag =
							value || DEFAULT_SETTINGS.yamlFrontMatterBoostTag;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show scores")
			.setDesc("Show scores when displaying suggestions.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showScores)
					.onChange(async (value) => {
						this.plugin.settings.showScores = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
