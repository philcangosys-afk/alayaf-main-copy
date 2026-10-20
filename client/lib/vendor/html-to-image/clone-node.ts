import type { Options } from './types'
import { clonePseudoElements } from './clone-pseudos'
import {
  createImage,
  toArray,
  isInstanceOfElement,
  getStyleProperties,
} from './util'
import { getMimeType } from './mimes'
import { resourceToDataURL } from './dataurl'

async function cloneCanvasElement(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL()
  if (dataURL === 'data:,') {
    return canvas.cloneNode(false) as HTMLCanvasElement
  }
  return createImage(dataURL)
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  if (video.currentSrc) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = video.clientWidth
    canvas.height = video.clientHeight
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataURL = canvas.toDataURL()
    return createImage(dataURL)
  }

  const poster = video.poster
  const contentType = getMimeType(poster)
  const dataURL = await resourceToDataURL(poster, contentType, options)
  return createImage(dataURL)
}

async function cloneIFrameElement(iframe: HTMLIFrameElement, options: Options) {
  try {
    if (iframe?.contentDocument?.body) {
      return (await cloneNode(
        iframe.contentDocument.body,
        options,
        true,
      )) as HTMLBodyElement
    }
  } catch {
    // Failed to clone iframe
  }

  return iframe.cloneNode(false) as HTMLIFrameElement
}

async function cloneSingleNode<T extends HTMLElement>(
  node: T,
  options: Options,
): Promise<HTMLElement> {
  if (isInstanceOfElement(node, HTMLCanvasElement)) {
    return cloneCanvasElement(node)
  }

  if (isInstanceOfElement(node, HTMLVideoElement)) {
    return cloneVideoElement(node, options)
  }

  if (isInstanceOfElement(node, HTMLIFrameElement)) {
    return cloneIFrameElement(node, options)
  }

  return node.cloneNode(isSVGElement(node)) as T
}

const isSlotElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SLOT'

const isSVGElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SVG'

async function cloneChildren<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): Promise<T> {
  if (isSVGElement(clonedNode)) {
    return clonedNode
  }

  let children: T[] = []

  if (isSlotElement(nativeNode) && nativeNode.assignedNodes) {
    children = toArray<T>(nativeNode.assignedNodes())
  } else if (
    isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
    nativeNode.contentDocument?.body
  ) {
    children = toArray<T>(nativeNode.contentDocument.body.childNodes)
  } else {
    children = toArray<T>((nativeNode.shadowRoot ?? nativeNode).childNodes)
  }

  if (
    children.length === 0 ||
    isInstanceOfElement(nativeNode, HTMLVideoElement)
  ) {
    return clonedNode
  }

  await children.reduce(
    (deferred, child) =>
      deferred
        .then(() => cloneNode(child, options))
        .then((clonedChild: HTMLElement | null) => {
          if (clonedChild) {
            clonedNode.appendChild(clonedChild)
          }
        }),
    Promise.resolve(),
  )

  return clonedNode
}

// alayaf: skipDefaultStyles — computed values per element (read once, reused as the parent's values)
// and per-tag defaults from a blank standards-mode document. Reset for every toSvg call.
// Always copied: borders, outlines and colors (their defaults depend on other properties such as
// border-style and currentcolor), margins and paddings (em-based defaults would follow the reduced
// font size below), list styles (nested-list and summary defaults), plus a few cheap layout and text basics.
const ALWAYS_COPY =
  /^(color|display|position|float|font-size|font-family|direction|unicode-bidi|list-style-(type|position|image)|(margin|padding)-(top|right|bottom|left)|(border-(top|right|bottom|left)|outline|column-rule)-(width|style|color))$|-color$/
// Attributes that never change the user-agent style of an element. Any other attribute (align, nowrap,
// bgcolor, width, type, href, ...) may produce a presentational hint or a different UA rule in the
// clone, so such an element gets a full copy instead.
const STYLE_NEUTRAL_ATTRIBUTES = new Set([
  'class', 'id', 'style', 'lang', 'alt', 'src', 'srcset', 'sizes', 'colspan', 'rowspan',
  'headers', 'scope', 'name', 'role', 'tabindex', 'loading', 'decoding', 'crossorigin',
  'referrerpolicy', 'dir',
])

function hasStyleAffectingAttributes(element: Element) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    if (
      !STYLE_NEUTRAL_ATTRIBUTES.has(name) &&
      !name.startsWith('data-') &&
      !name.startsWith('aria-')
    ) {
      return true
    }
  }
  return false
}
let styleValueCache = new WeakMap<Element, string[]>()
const defaultValueCache = new Map<string, string[]>()
let defaultSandbox: HTMLIFrameElement | null = null

export function resetStyleCaches() {
  styleValueCache = new WeakMap<Element, string[]>()
}

export function disposeStyleSandbox() {
  defaultSandbox?.remove()
  defaultSandbox = null
  defaultValueCache.clear()
}

function readStyleValues(element: Element, names: string[]): string[] {
  let values = styleValueCache.get(element)
  if (!values) {
    const style = window.getComputedStyle(element)
    values = names.map((name) => style.getPropertyValue(name))
    styleValueCache.set(element, values)
  }
  return values
}

function defaultStyleValues(element: Element, names: string[]): string[] | null {
  const namespace = element.namespaceURI || 'http://www.w3.org/1999/xhtml'
  const key = `${namespace}|${element.localName}`
  const cached = defaultValueCache.get(key)
  if (cached) {
    return cached
  }
  if (!defaultSandbox || !defaultSandbox.isConnected) {
    defaultSandbox = document.createElement('iframe')
    defaultSandbox.setAttribute('aria-hidden', 'true')
    defaultSandbox.tabIndex = -1
    defaultSandbox.style.cssText =
      'position:fixed;left:-20000px;top:0;width:600px;height:400px;border:0;visibility:hidden;'
    document.body.appendChild(defaultSandbox)
    const sandboxDocument = defaultSandbox.contentDocument
    if (!sandboxDocument) {
      return null
    }
    sandboxDocument.open()
    sandboxDocument.write('<!DOCTYPE html><html><head></head><body></body></html>')
    sandboxDocument.close()
  }
  const sandboxDocument = defaultSandbox.contentDocument
  if (!sandboxDocument?.body) {
    return null
  }
  const probe = sandboxDocument.createElementNS(namespace, element.localName)
  sandboxDocument.body.appendChild(probe)
  const style = (sandboxDocument.defaultView || window).getComputedStyle(probe)
  const values = names.map((name) => style.getPropertyValue(name))
  probe.remove()
  defaultValueCache.set(key, values)
  return values
}

function cloneCSSStyle<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
) {
  const targetStyle = clonedNode.style
  if (!targetStyle) {
    return
  }

  const sourceStyle = window.getComputedStyle(nativeNode)
  if (options.skipDefaultStyles) {
    const names = getStyleProperties(options)
    const values = readStyleValues(nativeNode, names)
    const parent = nativeNode.parentElement
    const parentValues =
      parent && !hasStyleAffectingAttributes(nativeNode)
        ? readStyleValues(parent, names)
        : null
    const defaults = parentValues ? defaultStyleValues(nativeNode, names) : null
    // the source inline style is already part of the computed values; in the clone it could win
    // over a skipped property that an author !important rule had overridden in the source
    targetStyle.cssText = ''
    names.forEach((name, index) => {
      let value = values[index]
      if (
        defaults &&
        parentValues &&
        value === defaults[index] &&
        value === parentValues[index] &&
        !ALWAYS_COPY.test(name)
      ) {
        return
      }
      if (name === 'font-size' && value.endsWith('px')) {
        const reducedFont =
          Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1
        value = `${reducedFont}px`
      }
      if (
        isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
        name === 'display' &&
        value === 'inline'
      ) {
        value = 'block'
      }
      if (name === 'd' && clonedNode.getAttribute('d')) {
        value = `path(${clonedNode.getAttribute('d')})`
      }
      targetStyle.setProperty(name, value)
    })
    return
  }
  if (sourceStyle.cssText) {
    targetStyle.cssText = sourceStyle.cssText
    targetStyle.transformOrigin = sourceStyle.transformOrigin
  } else {
    getStyleProperties(options).forEach((name) => {
      let value = sourceStyle.getPropertyValue(name)
      if (name === 'font-size' && value.endsWith('px')) {
        const reducedFont =
          Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1
        value = `${reducedFont}px`
      }

      if (
        isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
        name === 'display' &&
        value === 'inline'
      ) {
        value = 'block'
      }

      if (name === 'd' && clonedNode.getAttribute('d')) {
        value = `path(${clonedNode.getAttribute('d')})`
      }

      targetStyle.setProperty(
        name,
        value,
        sourceStyle.getPropertyPriority(name),
      )
    })
  }
}

function cloneInputValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) {
    clonedNode.innerHTML = nativeNode.value
  }

  if (isInstanceOfElement(nativeNode, HTMLInputElement)) {
    clonedNode.setAttribute('value', nativeNode.value)
  }
}

function cloneSelectValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
    const clonedSelect = clonedNode as any as HTMLSelectElement
    const selectedOption = Array.from(clonedSelect.children).find(
      (child) => nativeNode.value === child.getAttribute('value'),
    )

    if (selectedOption) {
      selectedOption.setAttribute('selected', '')
    }
  }
}

function decorate<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
): T {
  if (isInstanceOfElement(clonedNode, Element)) {
    cloneCSSStyle(nativeNode, clonedNode, options)
    clonePseudoElements(nativeNode, clonedNode, options)
    cloneInputValue(nativeNode, clonedNode)
    cloneSelectValue(nativeNode, clonedNode)
  }

  return clonedNode
}

async function ensureSVGSymbols<T extends HTMLElement>(
  clone: T,
  options: Options,
) {
  const uses = clone.querySelectorAll ? clone.querySelectorAll('use') : []
  if (uses.length === 0) {
    return clone
  }

  const processedDefs: { [key: string]: HTMLElement } = {}
  for (let i = 0; i < uses.length; i++) {
    const use = uses[i]
    const id = use.getAttribute('xlink:href')
    if (id) {
      const exist = clone.querySelector(id)
      const definition = document.querySelector(id) as HTMLElement
      if (!exist && definition && !processedDefs[id]) {
        // eslint-disable-next-line no-await-in-loop
        processedDefs[id] = (await cloneNode(definition, options, true))!
      }
    }
  }

  const nodes = Object.values(processedDefs)
  if (nodes.length) {
    const ns = 'http://www.w3.org/1999/xhtml'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('xmlns', ns)
    svg.style.position = 'absolute'
    svg.style.width = '0'
    svg.style.height = '0'
    svg.style.overflow = 'hidden'
    svg.style.display = 'none'

    const defs = document.createElementNS(ns, 'defs')
    svg.appendChild(defs)

    for (let i = 0; i < nodes.length; i++) {
      defs.appendChild(nodes[i])
    }

    clone.appendChild(svg)
  }

  return clone
}

export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  isRoot?: boolean,
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) {
    return null
  }

  return Promise.resolve(node)
    .then((clonedNode) => cloneSingleNode(clonedNode, options) as Promise<T>)
    .then((clonedNode) => cloneChildren(node, clonedNode, options))
    .then((clonedNode) => decorate(node, clonedNode, options))
    .then((clonedNode) => ensureSVGSymbols(clonedNode, options))
}
