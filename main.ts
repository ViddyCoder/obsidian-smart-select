import { Console } from 'console';
import { Editor, EditorPosition, MarkdownView, Plugin } from 'obsidian';

enum Granularity {
	Word = "WORD",
	Clause = "CLAUSE",
	Sentence = "SENTENCE",
	Paragraph = "PARA",
	Cluster = "CLUSTER",
	Section = "SECTION"
}

const GraduatedSelectionList = [
	Granularity.Clause,
	Granularity.Sentence,
	Granularity.Paragraph,
	Granularity.Cluster,
	Granularity.Section	
]

const GraduatedSelectionDict = {
	[Granularity.Word] : Granularity.Clause,
	[Granularity.Clause] : Granularity.Sentence,
	[Granularity.Sentence] : Granularity.Paragraph,
	[Granularity.Paragraph] : Granularity.Cluster,
	[Granularity.Cluster] : Granularity.Section,
	[Granularity.Section] : Granularity.Section
};

const gDefaultGranularity = Granularity.Clause;
let gNextGranularity = gDefaultGranularity;

const SECTION_PATTERN = /((.*[\r\n])*)#+\s/gm;
const CLUSTER_PATTERN = /(?:.*(?:\r?\n|$))+?(?=\r?\n\r?\n|$)/gm;
const PARA_PATTERN = /([^\r\n]+[\r\n])/gm;
const SENTENCE_PATTERN = /([^\r\n.?!]+(\.[0-9]+)*[.?!"]*[^\S\r\n]*)/gm;
const CLAUSE_PATTERN = /([^\r\n\"\{\}\[\].?!,:;]+(\.[0-9]+)*[.?!,:;]*[^\S\r\n]*)[\r\n]*/gm;
const WORD_PATTERN = /(([\*~=]+)*[a-zA-Z0-9'~@#$-]+(\.[0-9]+)*([\*~=]+)*)/gm;

const GranularityToPattern = {
	[Granularity.Word] : WORD_PATTERN,
	[Granularity.Clause] : CLAUSE_PATTERN,
	[Granularity.Sentence] : SENTENCE_PATTERN,
	[Granularity.Paragraph] : PARA_PATTERN,
	[Granularity.Cluster] : CLUSTER_PATTERN,
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
		gNextGranularity = gDefaultGranularity;
		console.debug("Granularity reset to default");
	}

	if (gNextGranularity === Granularity.Section) {
		smartSelectSection(editor);
		return;
	}
	
	if (gNextGranularity === Granularity.Cluster) {
		smartSelectCluster(editor);
		return;
	}

	if (gNextGranularity === Granularity.Paragraph) {
		smartSelectParagraph(editor);
		return;
	}
	
	let paragraphIndex = GraduatedSelectionList.findIndex(item => item === Granularity.Paragraph);
	const currentIndex = GraduatedSelectionList.findIndex(item => item === gNextGranularity);

	if (currentIndex >= paragraphIndex) {
		gNextGranularity = GraduatedSelectionDict[gNextGranularity];
		smartSelect(editor);
		console.debug("Quitting");
		return;
	}
	
	let match;
	let matchPositions = [];
	let pattern = GranularityToPattern[gNextGranularity];

	pattern.lastIndex = 0;
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
	
	/*
	if (gNextGranularity === Granularity.Word && matchPositions.length > 0) {
		// Modify final match position.
		let lastIndex = matchPositions.length - 1;
		let lineLength = editor.getLine(cursorPosB.line).length;
		let wordEndPos = matchPositions[lastIndex][0] + matchPositions[lastIndex][1];
		matchPositions[lastIndex][1] = matchPositions[lastIndex][1] + lineLength - wordEndPos;
	}
	*/
	
	if (gNextGranularity === Granularity.Word && matchPositions.length > 0) {
		// Add a final match position.
		let lastIndex = matchPositions.length - 1;
		let lineLength = editor.getLine(cursorPosB.line).length;
		let wordEndPos = matchPositions[lastIndex][0] + matchPositions[lastIndex][1];
		if (wordEndPos < lineLength) {
			matchPositions.push([wordEndPos, lineLength - wordEndPos]);
		}
	}

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
		
		if (gNextGranularity === Granularity.Word && i > 0) { // Edge case. Cursor is between last word and last period at end of paragraph.
			let nextA = matchPositions[i-1][0];
			let nextB = nextA + matchPositions[i-1][1];
			if (cursorPosA.ch === posA && cursorPosA.ch === nextB) {
				continue;
			}
		}

		console.debug("A selection was found!");
		editor.setSelection({line: cursorPosA.line, ch: posA}, {line: cursorPosA.line, ch: posB});
		break;		
	}
	
	savePosition(editor);
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

function smartSelectParagraph(editor: Editor) {
	const cursorPosA = editor.getCursor("anchor");
	const cursorPosB = editor.getCursor("head");
	const lineText = editor.getLine(cursorPosA.line);
	
	if (cursorPosA.ch === 0 && cursorPosB.ch === lineText.length) {
		console.debug("All we did was select the already selected paragraph. Go to cluster granularity.");
		savePosition(editor);
		gNextGranularity = Granularity.Cluster;
		smartSelectCluster(editor);
		return;
	} else {
		editor.setSelection({ line: cursorPosA.line, ch: 0 }, { line: cursorPosA.line, ch: lineText.length });
		savePosition(editor);
		gNextGranularity = Granularity.Cluster;
		console.debug("Para Setting next granularity to: " + gNextGranularity.valueOf());
	}
}

const NEWLINE_PATTERN = /^[\r\n]+$/gm;
function smartSelectCluster(editor: Editor) {
	const cursorPosA = editor.getCursor("anchor");
	const cursorPosB = editor.getCursor("head");
	let lineA = cursorPosA.line;
	let lineB = cursorPosB.line;
	const lineCount = editor.lineCount();
	
	let lineText = editor.getLine(lineA).trim();
	if (lineText.charAt(0) === "#") {
		console.log("we're at a section");
		editor.setSelection({line: lineA, ch: 0}, {line: lineB, ch: lineB.length});
		gNextGranularity = Granularity.Section;
		smartSelectSection(editor);
		return;
	}
	
	while(lineA > 0) {
		lineText = editor.getLine(lineA).trim();
		if (lineText.length === 0) {
			lineA++;
			break;
		}
		lineA--;
	}
	
	while(lineB < lineCount) {
		lineText = editor.getLine(lineB).trim();
		if (lineText.length === 0) {
			break;
		}
		if (lineText.charAt(0) === "#") {
			lineB--;
			break;
		}
		lineB++;
	}
	
	editor.setSelection({line: lineA, ch: 0}, {line: lineB, ch: lineB.length});
	
	if (!cursorChanged(editor)) {
		lineB++;
		if (lineText = editor.getLine(lineB).trim().charAt(0) !== "#") {
			editor.setSelection({line: lineA, ch: 0}, {line: lineB, ch: lineB.length});		
		}
	}
	
	savePosition(editor);

}

const HEADER_PATTERN = /^(#+)[^\S\r\n]*.*/gm;
function smartSelectSection(editor: Editor) {

	const cursorPosA = editor.getCursor("anchor");
	const cursorPosB = editor.getCursor("head");
	const lineA = cursorPosA.line;
	const lineText = editor.getLine(lineA);
	
	HEADER_PATTERN.lastIndex = 0;
	const match = HEADER_PATTERN.exec(lineText);

	if (!match) {
		console.debug("No header match");
		return;
	}

	let headerLevelA = match[1].length;
	let lineB = lineA + 1;
	let matchB;
	const lineCount = editor.lineCount();

	while(lineB < lineCount) {
		HEADER_PATTERN.lastIndex = 0;
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
