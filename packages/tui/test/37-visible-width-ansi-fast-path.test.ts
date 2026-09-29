import assert from "node:assert";
import { describe, it } from "node:test";
import { visibleWidth } from "../src/utils.ts";

describe("visibleWidth ANSI + ASCII fast path (issue 37)", () => {
	it("measures colored ASCII text (CSI SGR codes have zero width)", () => {
		assert.strictEqual(visibleWidth("\x1b[31merror\x1b[0m: file not found"), 21);
	});

	it("measures mixed 256-color and RGB SGR codes", () => {
		assert.strictEqual(visibleWidth("\x1b[38;5;240mdim\x1b[38;2;10;20;30mtext\x1b[0m"), 7);
	});

	it("counts tabs as 3 columns", () => {
		assert.strictEqual(visibleWidth("a\tb"), 5);
		assert.strictEqual(visibleWidth("\x1b[1ma\tb\x1b[0m"), 5);
	});

	it("measures OSC 8 hyperlinks as their visible text only", () => {
		assert.strictEqual(visibleWidth("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\"), 4);
	});

	it("falls back to the general path for CJK and ANSI mixed content", () => {
		// CJK chars are 2 columns each; ANSI codes are 0.
		assert.strictEqual(visibleWidth("\x1b[32m中文\x1b[0m"), 4);
	});

	it("handles a lone ESC without a valid sequence like the general path", () => {
		// A stray ESC is a control character (width 0) in the general path.
		assert.strictEqual(visibleWidth("a\x1bb"), 2);
	});
});
