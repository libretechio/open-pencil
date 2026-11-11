import { closeTab, createDocumentTab } from '@/app/tabs'

import type { DesignTemplate } from './catalog'

export async function openDesignTemplate(template: DesignTemplate): Promise<void> {
  const tab = createDocumentTab('design')
  try {
    await tab.store.importDOMText(template.html, { documentName: template.name })
  } catch (error) {
    await closeTab(tab.id, 'discard').catch(() => undefined)
    throw error
  }
}
