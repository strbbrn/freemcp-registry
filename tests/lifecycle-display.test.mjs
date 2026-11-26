import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleDisplay } from '../public/lifecycle-display.js';

const cases = [
  [false, null, '', '', 0],
  [false, 'Active', '', '', 0],
  [false, 'Archived', 'Archived', 'Archived repository', 1],
  [false, 'Disabled', 'Repository disabled', 'Repository disabled', 1],
  [true, null, 'Archived', 'Archived implementation', 1],
  [true, 'Active', 'Archived', 'Archived implementation', 1],
  [true, 'Archived', 'Archived', 'Archived implementation', 2],
  [true, 'Disabled', 'Repository disabled', 'Repository disabled', 2],
];

for (const [editorial, status, badge, warningTitle, sourceCount] of cases) {
  test(`lifecycle display with registry archive ${editorial} and GitHub ${status ?? 'unavailable'}`, () => {
    for (const lastChecked of [false, true]) {
      const display = lifecycleDisplay(editorial, status, lastChecked);
      assert.equal(display.badge, badge);
      assert.equal(display.warningTitle, warningTitle);
      assert.equal(Boolean(display.warning), Boolean(badge));
      assert.equal(display.repositoryLabel, status ? status + (lastChecked ? ' (last checked)' : '') : 'Unavailable');
      const editorialNote = display.warning.includes('FreeMCP lists this implementation as archived.');
      const githubNote = display.warning.includes('GitHub');
      assert.equal(editorialNote, editorial);
      assert.equal(Number(editorialNote) + Number(githubNote), sourceCount);
      assert.equal(display.warning.includes('At the last check'), lastChecked && githubNote);
      assert.equal((display.warning.match(/Review maintained alternatives/g) ?? []).length, badge ? 1 : 0);
    }
  });
}
