import { getOrCreate } from '@embroider/core';
import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import partition from 'lodash/partition';
import Placeholder from './html-placeholder';

export class HTMLEntrypoint {
  private dom: JSDOM;
  private placeholders: Map<string, Placeholder[]> = new Map();
  modules: string[] = [];
  scripts: string[] = [];
  styles: string[] = [];

  constructor(private pathToVanillaApp: string, private rootURL: string, public filename: string) {
    this.dom = new JSDOM(readFileSync(join(this.pathToVanillaApp, this.filename), 'utf8'));

    for (let tag of this.handledStyles()) {
      let styleTag = tag as HTMLLinkElement;
      let href = styleTag.href;
      if (!isAbsoluteURL(href)) {
        let url = this.relativeToApp(href);
        this.styles.push(url);
        let placeholder = new Placeholder(styleTag);
        let list = getOrCreate(this.placeholders, url, () => []);
        list.push(placeholder);
      }
    }

    for (let scriptTag of this.handledScripts()) {
      // scriptTag.src include rootURL. Convert it to be relative to the app.
      let src = this.relativeToApp(scriptTag.src);

      if (scriptTag.type === 'module') {
        this.modules.push(src);
      } else {
        this.scripts.push(src);
      }

      let placeholder = new Placeholder(scriptTag);
      let list = getOrCreate(this.placeholders, src, () => []);
      list.push(placeholder);
    }
  }

  private relativeToApp(rootRelativeURL: string) {
    return rootRelativeURL.replace(this.rootURL, '');
  }

  private handledScripts() {
    let scriptTags = [...this.dom.window.document.querySelectorAll('script')] as HTMLScriptElement[];
    let [ignoredScriptTags, handledScriptTags] = partition(scriptTags, scriptTag => {
      return !scriptTag.src || scriptTag.hasAttribute('data-embroider-ignore') || isAbsoluteURL(scriptTag.src);
    });
    for (let scriptTag of ignoredScriptTags) {
      scriptTag.removeAttribute('data-embroider-ignore');
    }
    return handledScriptTags;
  }

  private handledStyles() {
    let styleTags = [...this.dom.window.document.querySelectorAll('link[rel="stylesheet"]')] as HTMLLinkElement[];
    let [ignoredStyleTags, handledStyleTags] = partition(styleTags, styleTag => {
      return !styleTag.href || styleTag.hasAttribute('data-embroider-ignore') || isAbsoluteURL(styleTag.href);
    });
    for (let styleTag of ignoredStyleTags) {
      styleTag.removeAttribute('data-embroider-ignore');
    }
    return handledStyleTags;
  }

  render(bundles: Map<string, string[]>, lazyBundles: Set<string>, rootURL: string): string {
    let insertedLazy = false;

    for (let [src, placeholders] of this.placeholders) {
      let matchingBundles = bundles.get(src);
      if (matchingBundles) {
        for (let placeholder of placeholders) {
          insertedLazy = maybeInsertLazyBundles(insertedLazy, lazyBundles, placeholder, rootURL);
          for (let matchingBundle of matchingBundles) {
            let src = rootURL + matchingBundle;
            placeholder.insertURL(src);
          }
        }
      } else {
        // no match means keep the original HTML content for this placeholder.
        // (If we really wanted it empty instead, there would be matchingBundles
        // and it would be an empty list.)
        for (let placeholder of placeholders) {
          placeholder.reset();
        }
      }
    }
    return this.dom.serialize();
  }
}

function isAbsoluteURL(url: string) {
  return /^(?:[a-z]+:)?\/\//i.test(url);
}

// we (somewhat arbitrarily) decide to put the lazy bundles before the very
// first <script> that we have rewritten
function maybeInsertLazyBundles(
  insertedLazy: boolean,
  lazyBundles: Set<string>,
  placeholder: Placeholder,
  rootURL: string
): boolean {
  if (!insertedLazy && placeholder.isScript()) {
    for (let bundle of lazyBundles) {
      let element = placeholder.start.ownerDocument.createElement('fastboot-script');
      element.setAttribute('src', rootURL + bundle);
      placeholder.insert(element);
    }
    return true;
  }
  return insertedLazy;
}
