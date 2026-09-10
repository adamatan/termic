import { LanguageSupport } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { hclLanguage } from "codemirror-lang-hcl";

// Atom One, the default dark theme, has no styles for typeName, labelName
// or bool. Keep HCL's semantic tags, with keyword/string alternatives so
// its block headers and literal values are also coloured by that theme.
export function hcl(): LanguageSupport {
  return new LanguageSupport(hclLanguage.configure({
    props: [styleTags({
      "BlockType!": [tags.typeName, tags.keyword],
      "BlockLabel!": [tags.labelName, tags.string],
      "true false": [tags.bool, tags.keyword],
      "null": [tags.null, tags.keyword],
    })],
  }));
}
