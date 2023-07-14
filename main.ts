import { Console } from 'console';
import { Editor, EditorPosition, MarkdownView, Plugin } from 'obsidian';

enum Granularity {
	Word = "WORD",
	Clause = "CLAUSE",
	Sentence = "SENTENCE",
	Paragraph = "PARA",
	Section = "SECTION"
}

const GraduatedSelectionDict = {
	[Granularity.Word] : Granularity.Clause,
	[Granularity.Clause] : Granularity.Sentence,
	[Granularity.Sentence] : Granularity.Paragraph,
	[Granularity.Paragraph] : Granularity.Section,
	[Granularity.Section] : Granularity.Section
};

let gNextGranularity = Granularity.Word;

const SECTION_PATTERN = /((.*[\r\n])*)#+\s/gm;
const PARA_PATTERN = /([^\r\n]+[\r\n])/gm;
const SENTENCE_PATTERN = /([^\r\n.?!]+(\.[0-9]+)*[.?!"]*[^\S\r\n]*)/gm;
const CLAUSE_PATTERN = /([^\r\n\"\{\}\[\].?!,:;]+(\.[0-9]+)*[.?!,:;]*[^\S\r\n]*)[\r\n]*/gm;
const WORD_PATTERN = /(([\*~=]+)*[a-zA-Z0-9'~@#$-]+(\.[0-9]+)*([\*~=]+)*)/gm;

const GranularityToPattern = {
	[Granularity.Word] : WORD_PATTERN,
	[Granularity.Clause] : CLAUSE_PATTERN,
	[Granularity.Sentence] : SENTENCE_PATTERN,
	[Granularity.Paragraph] : PARA_PATTERN,
	[Granularity.Section] : SECTION_PATTERN
}

const WORD_SEARCH_RADIUS = 500; // 1000 Characters

function smartSelect(editor: Editor) {
	const cursorPosA = editor.getCursor("anchor");
	const cursorPosB = editor.getCursor("head");
	const lineText = editor.getLine(cursorPosA.line);

	if (lineText.trimEnd().length === 0) {
		return;
	}
	
	console.debug("Processing current granularity: " + gNextGranularity.valueOf());

	if(cursorChanged(editor)) {
		gNextGranularity = Granularity.Word;
		console.debug("granularity reset to word");
	}

	if (gNextGranularity === Granularity.Section) {
		smartSelectSection(editor);
		return;
	}

	if (gNextGranularity === Granularity.Paragraph) {
		if (cursorPosA.ch === 0 && cursorPosB.ch === lineText.length) {
			console.debug("All we did was select the already selected paragraph. Go to next granularity.");
			gNextGranularity = GraduatedSelectionDict[gNextGranularity];
			savePosition(editor);
			smartSelect(editor);
		} else {
			editor.setSelection({ line: cursorPosA.line, ch: 0 }, { line: cursorPosA.line, ch: lineText.length });
			savePosition(editor);
			gNextGranularity = GraduatedSelectionDict[gNextGranularity];
		}
		return;
	}

	let match;
	let matchPositions = [];
	let pattern = GranularityToPattern[gNextGranularity];

	while((match = pattern.exec(lineText)) !== null) {
		
		let index = match.index;
		let length = match[0].length;
		if (length === 0) { continue; }

		if (gNextGranularity === Granularity.Clause) {
			for (let i = 0; i < match[0].length; i++) {
				if (match[0].substring(i, 1) === ' ') {
					index++;
					length--;
				}
				else {
					break;
				}
			}
		}
		matchPositions.push([index, length]);
	}

	let foundSelection = false;
	for (var i = matchPositions.length - 1; i >= 0; i--) {
		let posA = matchPositions[i][0];
		let posB = posA + matchPositions[i][1];

		if (cursorPosA.ch < posA) {
			continue;
		}

		if (gNextGranularity === Granularity.Word && cursorPosB.ch > posB) {
			continue
		} 

		if (cursorPosA.ch === posA && cursorPosB.ch === posB) {
			gNextGranularity = GraduatedSelectionDict[gNextGranularity];
			console.debug("New selection equals old. Go up one granularity.");
			smartSelect(editor);
			break;
		}

		foundSelection = true;
		console.debug("A selection was found!");
		editor.setSelection({line: cursorPosA.line, ch: posA}, {line: cursorPosA.line, ch: posB});
		break;		
	}

	if (!foundSelection) {
		console.debug("A selection was not found. Rerun at the next granularity.");
		gNextGranularity = GraduatedSelectionDict[gNextGranularity];
		smartSelect(editor);
		return;
	}

	savePosition(editor);
	gNextGranularity = GraduatedSelectionDict[gNextGranularity];
	console.debug("Setting next granularity to: " + gNextGranularity.valueOf());
}

let lastHead: EditorPosition;
let lastAnchor: EditorPosition;

function cursorsAreEqual(a: EditorPosition, b: EditorPosition) {
	if (!a && !b) {return true;}
	if (!a || !b) {return false;}
	return (a.line === b.line && a.ch === b.ch);
}
function cursorChanged(editor: Editor) {
	if (cursorsAreEqual(lastHead, editor.getCursor("head"))
		&& cursorsAreEqual(lastAnchor, editor.getCursor("anchor"))) {
		console.debug("cursor didn't change");
		return false;
	}
	else {
		lastHead = editor.getCursor("head");
		lastAnchor = editor.getCursor("anchor");
		console.debug("cursor changed");
		return true;
	}
}
function savePosition(editor: Editor) {
	lastHead = editor.getCursor("head");
	lastAnchor = editor.getCursor("anchor");
}

const HEADER_PATTERN = /^(#+)[^\S\r\n]+.*/gm;
function smartSelectSection(editor: Editor) {
	const cursorPosA = editor.getCursor("anchor");
	const cursorPosB = editor.getCursor("head");
	const lineText = editor.getLine(cursorPosA.line);

	const lineA = cursorPosA.line;
	const match = HEADER_PATTERN.exec(editor.getLine(lineA));
	if (!match) {
		return;
	}

	let headerLevelA = match[1].length;
	let lineB = lineA + 1;
	let matchB;
	const lineCount = editor.lineCount();

	while(lineB < lineCount) {
		matchB = HEADER_PATTERN.exec(editor.getLine(lineB));
		if(!matchB) {
			lineB++; 
			continue;
		}
		let headerLevelB = matchB[1].length;
		if (headerLevelA < headerLevelB) {
			lineB++;
			continue
		}
		break;
	}
	editor.setSelection({line: lineA, ch: 0}, {line: lineB, ch: 0});
	savePosition(editor);
}

export default class SelectCurrentLinePlugin extends Plugin {

	async onload() {
	
		// This adds an editor command on the current editor instance
		this.addCommand({
			id: 'smart-select',
			name: 'Smart Select',
			icon: 'move-horizontal',
			hotkeys: [{modifiers: [], key: 'Escape'}],
			editorCallback: (editor: Editor) => {
				smartSelect(editor);
			}
		});
	}

	onunload() {
	}
}
