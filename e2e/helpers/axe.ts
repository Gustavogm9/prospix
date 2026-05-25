/**
 * Shared axe-core accessibility testing helper.
 *
 * Extracts the duplicated `runAxe` function used across multiple E2E specs
 * into a single importable helper.
 *
 * L-17 audit finding.
 */
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

export interface AxeResult {
  blocking: import('axe-core').Result[];
  all: import('axe-core').Result[];
}

/**
 * Run axe-core accessibility analysis on the current page.
 *
 * @param page - Playwright Page object
 * @param label - Human-readable label for console output
 * @returns Object with `blocking` (critical/serious) and `all` violations
 */
export async function runAxe(page: Page, label: string): Promise<AxeResult> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact && BLOCKING_IMPACTS.has(v.impact),
  );

  if (results.violations.length > 0) {
    console.log(`\n[a11y · ${label}] total violations:`, results.violations.length);
    for (const v of results.violations) {
      console.log(`  · ${v.impact ?? 'unknown'} · ${v.id} · ${v.help}`);
    }
  }

  return { blocking, all: results.violations };
}
