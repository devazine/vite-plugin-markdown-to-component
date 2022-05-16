import Frontmatter from 'front-matter'
import MarkdownIt from 'markdown-it'
import markdownItAttrs from 'markdown-it-attrs'
import { Plugin } from 'vite'
import { TransformResult } from 'rollup'
import { parseDOM, DomUtils } from 'htmlparser2'
import { Element, Node as DomHandlerNode } from 'domhandler'
import { formatHTML, generateTocHTML } from './extend'

export interface PluginOptions {
  disableWrapperSyntax?: boolean
  classPrefix?: string
  disableCustomizedClass?: boolean
  disableDecodeEntry?: boolean
  disableInertTocToHTML?: boolean
  leftDelimiter?: boolean
  rightDelimiter?: boolean
  allowedAttributes?: boolean
  disableKaTeX?: boolean
  katexOptions?: object
  markdown?: (body: string) => string
  markdownIt?: MarkdownIt | MarkdownIt.Options
}



const markdownCompiler = (options: PluginOptions): MarkdownIt | { render: (body: string) => string } => {
  if (options.markdownIt) {
    if (options.markdownIt instanceof MarkdownIt || (options.markdownIt?.constructor?.name === 'MarkdownIt')) {
      return options.markdownIt as MarkdownIt
    } else if (typeof options.markdownIt === 'object') {
      return MarkdownIt(options.markdownIt)
    }
  } else if (options.markdown) {
    return { render: options.markdown }
  }
  const md = MarkdownIt({ html: true, xhtmlOut: false }) // TODO: xhtmlOut should be got rid of in next major update
  return md.use(markdownItAttrs, {
    // optional, these are default options
    leftDelimiter: options.leftDelimiter || '{',
    rightDelimiter: options.rightDelimiter || '}',
    allowedAttributes: options.allowedAttributes || [],  // empty array = all attributes are allowed
  })
}

class ExportedContent {
  #exports: string[] = []
  #contextCode = ''

  addContext(contextCode: string): void {
    this.#contextCode += `${contextCode}\n`
  }

  addExporting(exported: string): void {
    this.#exports.push(exported)
  }

  export(): string {
    return [this.#contextCode, `export default VueComponent`].join('\n')
  }
}

const tf = (code: string, id: string, options: PluginOptions): TransformResult => {
  if (!id.endsWith('.md')) return null

  const content = new ExportedContent()
  const fm = Frontmatter<unknown>(code)

  let html = markdownCompiler(options).render(fm.body)
  html = formatHTML(html, options)

  const getTOC = (h = '') => {
    const root = parseDOM(h)
    const indicies = root.filter(
      rootSibling => rootSibling instanceof Element && ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(rootSibling.tagName)
    ) as Element[]

    const tocObj: { level: string; content: string }[] = indicies.map(index => ({
      level: index.tagName.replace('h', ''),
      content: DomUtils.getInnerHTML(index),
    }))

    return tocObj
  }

  const toc = getTOC(html)

  if (!options.disableInertTocToHTML && html.indexOf('<p>[toc]</p>') === 0) {
    html = html.replace(/^<p>\[toc\]<\/p>/, '')
    html = `${generateTocHTML(toc)}${html}`
  }

  if (true) {
    const root = parseDOM(html)
    // Top-level <pre> tags become <pre v-pre>
    root.forEach((node: DomHandlerNode) => {
      if (node instanceof Element) {
        if (['pre', 'code'].includes(node.tagName)) {
          node.attribs['v-pre'] = 'true'
        }
      }
    })

    // Any <code> tag becomes <code v-pre> excepting under `<pre>`
    const markCodeAsPre = (node: DomHandlerNode): void => {
      if (node instanceof Element) {
        if (node.tagName === 'code') node.attribs['v-pre'] = 'true'
        if (node.childNodes.length > 0) node.childNodes.forEach(markCodeAsPre)
      }
    }
    root.forEach(markCodeAsPre)

    const { code: compiledVueCode } = require('@vue/compiler-sfc').compileTemplate({ source: DomUtils.getOuterHTML(root, { decodeEntities: true }), filename: id, id })
    content.addContext(compiledVueCode.replace('\nexport function render(', '\nfunction vueRender(') + `\nconst VueComponent = { render: vueRender }\nVueComponent.__hmrId = ${JSON.stringify(id)}\nVueComponent.__toc =  ${JSON.stringify(toc)}\n`)
    content.addExporting('VueComponent')
  }

  return {
    code: content.export(),
  }
}

export const plugin = (options: PluginOptions = {}): Plugin => {
  return {
    name: 'vite-plugin-markdown-to-component',
    enforce: 'pre',
    transform(code, id) {
      return tf(code, id, options)
    },
  }
}

export default plugin
exports.default = plugin
