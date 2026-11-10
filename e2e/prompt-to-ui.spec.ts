import { test, expect } from '@playwright/test';

// Réponse LLM FIGÉE (fixture). Zéro appel réseau réel = test rapide, gratuit, déterministe.
const fakeCompose = {
  updatedClauses: [
    { id: 'clause_1', text: 'a pricing page with a big title', category: 'layout', origin: 'explicit', alternatives: [] },
  ],
  removedClauseIds: [],
  ops: [
    {
      type: 'add',
      node: {
        id: 'node_1', role: 'heading', parentId: null, order: 0,
        content: 'Pricing', tailwind: 'text-4xl font-bold',
        provenance: { promptClauseId: 'clause_1', source: 'llm' },
      },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  // 1. Simule un utilisateur connecté (clé factice en localStorage)
  await page.addInitScript(() => {
    localStorage.setItem('wysiwyc.settings.v1', JSON.stringify({
      activeProvider: 'anthropic',
      keys: { anthropic: 'sk-test', openai: '', mistral: '', groq: '' },
    }));
  });
  // 2. Intercepte l'appel navigateur -> API Anthropic
  await page.route('https://api.anthropic.com/v1/messages', (route) =>
    route.fulfill({
      json: {
        content: [{ type: 'text', text: JSON.stringify(fakeCompose) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    }),
  );
});

test('prompt -> le titre apparait sur le canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Describe the UI you want…').first().fill('a pricing page with a big title');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Pricing')).toBeVisible();
});
