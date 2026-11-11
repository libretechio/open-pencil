import type { EditorStore } from '@/app/editor/active-store'

import type { LessonStep, VerificationResult } from './types'

const EPSILON = 0.01

function equalNumber(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= EPSILON
}

export function verifyLessonStep(store: EditorStore, step: LessonStep): VerificationResult {
  const selected = [...store.state.selectedIds]
  if (selected.length !== 1) {
    return {
      passed: false,
      summary: 'Select exactly one frame.',
      details: [`The tutor currently sees ${selected.length} selected layers.`]
    }
  }
  const node = store.graph.getNode(selected[0])
  if (node?.type !== 'FRAME') {
    return {
      passed: false,
      summary: 'The selected layer is not a frame.',
      details: [
        node ? `Selected layer type: ${node.type}.` : 'The selected layer no longer exists.'
      ]
    }
  }
  const expected = step.verification
  const details: string[] = []
  if (node.layoutMode === 'NONE') details.push('Auto layout is not enabled.')
  if (expected.direction && node.layoutMode !== expected.direction) {
    details.push(
      `Direction is ${node.layoutMode.toLowerCase()}, expected ${expected.direction.toLowerCase()}.`
    )
  }
  if (expected.gap !== undefined && !equalNumber(node.itemSpacing, expected.gap)) {
    details.push(`Item gap is ${node.itemSpacing}px, expected ${expected.gap}px.`)
  }
  if (expected.horizontalPadding !== undefined) {
    const values = [node.paddingLeft, node.paddingRight]
    if (!values.every((value) => equalNumber(value, expected.horizontalPadding as number))) {
      details.push(
        `Horizontal padding is ${values.join(' / ')}px, expected ${expected.horizontalPadding}px.`
      )
    }
  }
  if (expected.verticalPadding !== undefined) {
    const values = [node.paddingTop, node.paddingBottom]
    if (!values.every((value) => equalNumber(value, expected.verticalPadding as number))) {
      details.push(
        `Vertical padding is ${values.join(' / ')}px, expected ${expected.verticalPadding}px.`
      )
    }
  }
  if (expected.padding !== undefined) {
    const values = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]
    if (!values.every((value) => equalNumber(value, expected.padding as number))) {
      details.push(
        `Padding is ${values.join(' / ')}px, expected ${expected.padding}px on every edge.`
      )
    }
  }
  return details.length === 0
    ? {
        passed: true,
        summary: 'Checkpoint passed.',
        details: ['The selected frame matches this step.']
      }
    : { passed: false, summary: 'This checkpoint is not finished yet.', details }
}
