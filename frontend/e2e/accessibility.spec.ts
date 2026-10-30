import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { exchange, mockApi } from './mock-api'

// WCAG 2.2 A and AA rules, checked on every screen state in both themes.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} — ${violation.nodes
        .map((node) => `${node.target.join(' ')} ${node.html.slice(0, 120)}`)
        .join(', ')}`,
  )
  expect(summary).toEqual([])
}

for (const theme of ['nord', 'dim'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('theme', value)
      }, theme)
    })

    test('empty state has no accessibility violations', async ({ page }) => {
      await mockApi(page, { answer: () => ({ reply: 'ok' }) })
      await page.goto('/')
      await expect(page.getByText('What would you like to know?')).toBeVisible()

      await expectNoViolations(page)
    })

    test('conversation has no accessibility violations', async ({ page }) => {
      await mockApi(page, {
        history: [
          exchange(2, 'And in one line?', 'A contract between **programs**.'),
          exchange(1, 'What is an API?', 'An API is:\n\n- a contract\n- with `endpoints`'),
        ],
        answer: () => ({ reply: 'ok' }),
      })
      await page.goto('/')
      await expect(page.getByText('A contract between')).toBeVisible()

      await expectNoViolations(page)
    })

    test('error state has no accessibility violations', async ({ page }) => {
      await mockApi(page, { answer: () => ({ error: 'Rate limit reached', status: 429 }) })
      await page.goto('/')
      await page.getByLabel('Message').fill('Hi')
      await page.getByLabel('Message').press('Enter')
      await expect(page.getByRole('alert')).toBeVisible()

      await expectNoViolations(page)
    })
  })
}
