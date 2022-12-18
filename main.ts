import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	FileSystemAdapter,
	FuzzyMatch,
	FuzzySuggestModal,
	KeymapEventHandler,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import * as yaml from "js-yaml";
import yamlFront from "front-matter";

type SuggestionObject = {
	alias: string;
	path: string;
	originTFile: TFile;
	isAlias: boolean;
	extension: string;
	linkCount: number;
};

interface BoostLinkPluginSettings {
	triggerString: string;
	mode: Mode;
	apiVersion: number;
}

// From https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types:
const imageExtensions = [
	"jpg",
	"jpeg",
	"jfif",
	"pjpeg",
	"pjp",
	"png",
	"svg",
	"webp",
	"apng",
	"avif",
	"gif",
	"bmp",
	"ico",
	"cur",
	"tif",
	"tiff",
];

enum Mode {
	BoostLinkOpen = "Open",
	Standard = "Standard",
}

const DEFAULT_SETTINGS: BoostLinkPluginSettings = {
	triggerString: "b[",
	mode: Mode.Standard,
	apiVersion: 1,
};

export class AliasPromptModal extends Modal {
	newAlias: string;
	file: TFile;
	enterKeyHandler: KeymapEventHandler;

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
		this.enterKeyHandler = this.scope.register(
			[],
			"Enter",
			(evt: KeyboardEvent) => {
				this.submitAlias();
				return false;
			}
		);
	}

	async submitAlias() {
		const fileParsed = yamlFront(
			await app.vault.adapter.read(this.file.path)
		);
		const attributes: Record<string, any> = fileParsed.attributes;

		const frontMatterAliases = [
			...(attributes?.alias ? [attributes.alias] : []),
			...(attributes?.aliases
				? Array.isArray(attributes.aliases)
					? attributes.aliases
					: [attributes.aliases]
				: []),
			this.newAlias,
		];

		const newFrontMatter: Record<string, any> = fileParsed.attributes;

		if (Object.keys(newFrontMatter).includes("alias")) {
			delete newFrontMatter.alias;
		}
		if (Object.keys(newFrontMatter).includes("aliases")) {
			delete newFrontMatter.aliases;
		}

		const newContent = `---\n${yaml.dump({
			...newFrontMatter,
			aliases: frontMatterAliases,
		})}---\n\n${fileParsed.body}`;

		app.vault.adapter.write(this.file.path, newContent);

		this.scope.unregister(this.enterKeyHandler);
		this.close();
	}

	onOpen() {
		const { contentEl } = this;

		// contentEl.createEl("h1", { text: "New alias" });

		new Setting(contentEl).setName("New alias").addText((text) =>
			text.onChange((value) => {
				this.newAlias = value;
			})
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(async () => {
					this.submitAlias();
				})
		);
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

const getBoostedSuggestions = (
	plugin: BoostLinkPlugin,
	files: TFile[],
	filterString?: string
) => {
	console.log(154, files, plugin.app.metadataCache.resolvedLinks);

	let boostlinksGathered = files
		.map((file) => {
			let linkCount = Object.values(plugin.app.metadataCache.resolvedLinks[file.path] || {}).reduce((runningSum, c) => runningSum + c, 0);
			const frontMatter =
				plugin.app.metadataCache.getFileCache(file)?.frontmatter;

			const boost = frontMatter?.boost || 0;

			linkCount += boost;

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
					return {
						alias: `${alias}`,
						path: `${file.path}`,
						originTFile: file,
						isAlias: alias !== file.basename,
						extension: file.path.split(".").pop(),
						linkCount: linkCount,
					};

				})
				.flat();

			console.log(192, output);

			output = output.filter((a) => {
				if (a === undefined || a === null) {
					return false;
				}

				if (a === undefined) {
					return false;
				}

				if (!filterString) {
					return true;
				}

				const queryWords = filterString.toLowerCase().split(/\s{1,}/);

				return queryWords.every((word) => {
					return (
						a.alias.toLowerCase().contains(word) ||
						a.path.toLowerCase().contains(word)
					);
				});
			});

			console.log(218, output);

			return output;
		})
		.filter((a) => a.length)
		.flat()
		.filter((r) => r !== undefined && r !== null).sort((a, b) => b.linkCount - a.linkCount);

	console.log(219, boostlinksGathered);

	return boostlinksGathered;
};

const renderSuggestionObject = (
	suggestion: SuggestionObject,
	el: HTMLElement
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
	suggestionTextEl
		.createDiv({ cls: "boostlink-count" })
		.setText(`Count: ${suggestion.linkCount}`);
};

export default class BoostLinkPlugin extends Plugin {
	settings: BoostLinkPluginSettings;
	statusBar: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.registerEditorSuggest(
			new BoostLinkEditorSuggester(this, this.settings)
		);

		// From https://discord.com/channels/686053708261228577/840286264964022302/851183938542108692:
		if (this.app.vault.adapter instanceof FileSystemAdapter) {
			// On desktop.
			this.statusBar = this.addStatusBarItem();
			this.statusBar.setText(`BoostLink drop: ${this.settings.mode}`);

			this.statusBar.onClickEvent(async () => {
				this.settings.mode =
					this.settings.mode === Mode.Standard
						? Mode.BoostLinkOpen
						: Mode.Standard;
				this.statusBar.setText(`BoostLink drop: ${this.settings.mode}`);
				await this.saveSettings();
			});

			this.addCommand({
				id: "change-mode",
				icon: "switch",
				name: "Change mode",
				editorCallback: async (editor: Editor, view: MarkdownView) => {
					this.settings.mode =
						this.settings.mode === Mode.Standard
							? Mode.BoostLinkOpen
							: Mode.Standard;
					this.statusBar.setText(
						`BoostLink drop: ${this.settings.mode}`
					);
					await this.saveSettings();
				},
			});
		}

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

export class FilePathModal extends FuzzySuggestModal<SuggestionObject> {
	files: SuggestionObject[];
	onChooseItem: (item: SuggestionObject) => void;
	ctrlKeyHandler: KeymapEventHandler;

	constructor({
		app,
		fileOpener,
		onChooseFile,
		files,
	}: {
		app: App;
		fileOpener: boolean;
		onChooseFile: (
			onChooseItem: SuggestionObject,
			ctrlKey: boolean
		) => void;
		files: SuggestionObject[];
	}) {
		super(app);
		this.files = files;

		const instructions = [
			{ command: "⮁", purpose: "to navigate" },
			{
				command: "⤶",
				purpose: "to open",
			},
			{
				command: "esc",
				purpose: "to dismiss",
			},
		];

		if (fileOpener) {
			// Allow using Ctrl + Enter, following the example at
			// https://github.com/kometenstaub/obsidian-linked-data-vocabularies/blob/2eb4a8b206a2d8b455dc556f3d797c92c440c258/src/ui/LOC/suggester.ts#L41
			// (linked from https://discord.com/channels/686053708261228577/840286264964022302/988079192816107560)
			this.ctrlKeyHandler = this.scope.register(
				["Ctrl"],
				"Enter",
				(evt: KeyboardEvent) => {
					// @ts-ignore
					this.chooser.useSelectedItem(evt);
					return false;
				}
			);

			instructions.splice(2, 0, {
				command: "ctrl ⤶",
				purpose: "to open in new pane",
			});
		}

		this.setInstructions(instructions);

		this.onChooseSuggestion = (item: FuzzyMatch<SuggestionObject>, evt) => {
			this.scope.unregister(this.ctrlKeyHandler);
			onChooseFile(item.item, evt.ctrlKey);
		};
	}

	getItems(): SuggestionObject[] {
		return this.files;
	}

	renderSuggestion(
		item: FuzzyMatch<SuggestionObject>,
		el: HTMLElement
	): void {
		renderSuggestionObject(item.item, el);
	}

	getItemText(item: SuggestionObject): string {
		return `${item.path} ${item.alias} ${item.originTFile.path}`;
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

		console.log(426, match, triggerStringClosingBrackets);

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
		console.log(455);
		return getBoostedSuggestions(
			this.plugin,
			this.plugin.app.vault.getFiles(),
			context.query
		);
	}

	renderSuggestion(suggestion: SuggestionObject, el: HTMLElement): void {
		renderSuggestionObject(suggestion, el);
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
						this.plugin.app.workspace.getActiveFile().path,
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
	}
}
