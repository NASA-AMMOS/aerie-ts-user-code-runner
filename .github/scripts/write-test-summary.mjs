import fs from 'node:fs';

const report = fs.existsSync('test-output.txt')
	? fs.readFileSync('test-output.txt', 'utf8').trimEnd()
	: 'No test report was generated.';

const passed = process.env.TEST_OUTCOME === 'success';

const summary = [
	`## ${passed ? '✅ Tests passed' : '❌ Tests failed'}`,
	'',
	'<details open>',
	'<summary>Test results</summary>',
	'',
	'```text',
	report,
	'```',
	'</details>',
	'',
].join('\n');

fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
