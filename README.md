# Obsidian Boost Link Suggestions

An [Obsidian](https://obsidian.md) plugin for suggesting inline links ordered by link count and manual boosts.

## Motivation

Obsidian provides a built-in interface for suggesting files to link to (when typing `[[`, for example). Links in this interface are [currently based solely on search match](https://discord.com/channels/686053708261228577/716028884885307432/1053860523646656563). If some files are frequently linked to but are lower in the alphabet than other, less-frequently-linked-to files, this can lead to situations in which a higher-up file are mistakenly chosen over the more-frequently-linked-to file from the list of suggestions when writing quickly. This plugin addresses this situation by suggesting files in order of their incoming links, and further by allowing "boosting" specific files manually.

## Usage

### Linking to files

While typing in a markdown note, typing `b[` will bring up a searchable suggestion interface that lists files. This is equivalent to the file-linking interface built into Obsidian core, except that it uses a modifiable sorting approach. Specifically, files are listed by:

1. How many times the file is linked to in the Obisidian vault, _plus:_
2. A "boost" score from that file's YAML front-matter (by default, using the key "`boost`"):
	```md
	---
	aliases:
		- Example 1
		- Example 2

	boost: 100
	---

	# Example file 1

	...
	```

Within a file, suggestions are listed by aliases in order in which they are listed in the YAML front-matter, followed by the filename.

This allows "boosting" certain files such that they will always be at or near the top of the suggestions list.

Boost score calculations can optionally be shown in the suggestion interface by enabling the "Show scores" setting.

## Installation

### Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-boost-link-suggestions/`.

### From the Community Plugins list

1. Search for "Boost Link Suggestions" in Obsidian's community plugins browser
2. Enable the plugin in your Obsidian settings (find "Boost Link Suggestions" under "Community plugins").
3. Check the "Boost Link Suggestions" settings tab. Add one or more patterns.

## Development

Clone the repository, run `yarn` to install the dependencies, and run `yarn dev` to compile the plugin and watch file changes.

See https://github.com/obsidianmd/obsidian-api for Obsidian's API documentation.

## License

This plugin's code and documentation is released under the [BSD 3-Clause License](./LICENSE).

# Todo

Automated tests are not currently included in this code for this repository. Assistance in this, particularly using the [Obsidian End-to-End testing approach](https://github.com/trashhalo/obsidian-plugin-e2e-test), is especially welcome!

