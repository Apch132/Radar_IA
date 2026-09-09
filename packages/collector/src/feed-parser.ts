import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  InvalidXmlError,
  UnrecognizedFeedFormatError,
} from "./feed-errors.js";
import type { ParsedFeed, ParsedFeedItem } from "./feed-types.js";

type XmlValue = string | number | boolean | null | XmlObject | XmlValue[];
type XmlObject = { [key: string]: XmlValue };

const TEXT_KEY = "#text";
const ATTR_PREFIX = "@_";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  textNodeName: TEXT_KEY,
  // Strip namespace prefixes so Atom {http://...}feed becomes "feed".
  removeNSPrefix: true,
  // Decode character / predefined entities only. fast-xml-parser does not
  // resolve external entities (SYSTEM/PUBLIC), which blocks classic XXE.
  processEntities: true,
  trimValues: true,
  allowBooleanAttributes: true,
});

/**
 * Parse a raw RSS 2.0 or Atom 1.0 document into a normalized feed model.
 * Accepts UTF-8 bytes or an already-decoded string. Does not fetch URLs.
 */
export function parseFeed(input: Uint8Array | string): ParsedFeed {
  const xml = decodeInput(input);
  assertWellFormedXml(xml);

  let document: XmlObject;
  try {
    document = parser.parse(xml) as XmlObject;
  } catch (cause) {
    throw new InvalidXmlError("Invalid XML.", { cause });
  }

  if (hasOwn(document, "rss")) {
    return parseRss(asObject(document.rss));
  }
  if (hasOwn(document, "feed")) {
    return parseAtom(asObject(document.feed));
  }

  throw new UnrecognizedFeedFormatError();
}

function decodeInput(input: Uint8Array | string): string {
  if (typeof input === "string") {
    return input;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(input);
}

function assertWellFormedXml(xml: string): void {
  const result = XMLValidator.validate(xml, {
    allowBooleanAttributes: true,
  });
  if (result !== true) {
    const detail =
      typeof result === "object" && result.err?.msg
        ? result.err.msg
        : "malformed document";
    throw new InvalidXmlError(`Invalid XML: ${detail}.`);
  }
}

function parseRss(rss: XmlObject | null): ParsedFeed {
  if (!rss) {
    throw new UnrecognizedFeedFormatError("Invalid RSS document: missing root.");
  }

  const channel = firstObject(rss.channel);
  if (!channel) {
    throw new UnrecognizedFeedFormatError(
      "Invalid RSS document: missing channel.",
    );
  }

  const items = asArray(channel.item).map(parseRssItem);

  return {
    format: "rss",
    title: textOf(channel.title),
    description: textOf(channel.description),
    link: textOf(channel.link),
    language: textOf(channel.language),
    updatedAt:
      parseDate(textOf(channel.lastBuildDate)) ??
      parseDate(textOf(channel.pubDate)),
    items,
  };
}

function parseRssItem(raw: XmlValue): ParsedFeedItem {
  const item = asObject(raw) ?? {};
  const guid = textOf(item.guid);
  const contentEncoded =
    textOf(item["content:encoded"]) ?? textOf(item.encoded);

  return {
    title: textOf(item.title),
    link: textOf(item.link) ?? textOf(item.guid),
    id: guid,
    summary: textOf(item.description),
    author:
      textOf(item.author) ??
      textOf(item["dc:creator"]) ??
      textOf(item.creator),
    publishedAt: parseDate(textOf(item.pubDate)),
    categories: collectCategories(item.category),
    content: contentEncoded,
  };
}

function parseAtom(feed: XmlObject | null): ParsedFeed {
  if (!feed) {
    throw new UnrecognizedFeedFormatError("Invalid Atom document: missing root.");
  }

  const entries = asArray(feed.entry).map(parseAtomEntry);

  return {
    format: "atom",
    title: textOf(feed.title),
    description: textOf(feed.subtitle) ?? textOf(feed.tagline),
    link: pickAtomLink(feed.link),
    language:
      attributeOf(feed, "lang") ?? attributeOf(feed, "xml:lang"),
    updatedAt: parseDate(textOf(feed.updated)),
    items: entries,
  };
}

function parseAtomEntry(raw: XmlValue): ParsedFeedItem {
  const entry = asObject(raw) ?? {};
  const summary = textOf(entry.summary);
  const content = textOf(entry.content);

  return {
    title: textOf(entry.title),
    link: pickAtomLink(entry.link),
    id: textOf(entry.id),
    summary,
    author: pickAtomAuthor(entry.author),
    publishedAt:
      parseDate(textOf(entry.published)) ?? parseDate(textOf(entry.updated)),
    categories: collectAtomCategories(entry.category),
    content,
  };
}

function pickAtomLink(value: XmlValue | undefined): string | null {
  const links = asArray(value)
    .map((entry) => asObject(entry))
    .filter((entry): entry is XmlObject => entry !== null);

  if (links.length === 0) {
    return null;
  }

  const alternate = links.find((link) => {
    const rel = attributeOf(link, "rel");
    return rel === null || rel === "alternate";
  });
  const chosen = alternate ?? links[0];
  return attributeOf(chosen, "href") ?? textOf(chosen);
}

function pickAtomAuthor(value: XmlValue | undefined): string | null {
  const authors = asArray(value)
    .map((entry) => asObject(entry))
    .filter((entry): entry is XmlObject => entry !== null);

  if (authors.length === 0) {
    return textOf(value);
  }

  const primary = authors[0];
  return textOf(primary.name) ?? textOf(primary.email) ?? textOf(primary);
}

function collectCategories(value: XmlValue | undefined): string[] {
  return asArray(value)
    .map((entry) => textOf(entry))
    .filter((entry): entry is string => entry !== null);
}

function collectAtomCategories(value: XmlValue | undefined): string[] {
  return asArray(value)
    .map((entry) => {
      const object = asObject(entry);
      if (!object) {
        return textOf(entry);
      }
      return attributeOf(object, "term") ?? textOf(object);
    })
    .filter((entry): entry is string => entry !== null);
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function textOf(value: XmlValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = textOf(entry);
      if (text !== null) {
        return text;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    if (TEXT_KEY in value) {
      return textOf(value[TEXT_KEY]);
    }
  }
  return null;
}

function attributeOf(object: XmlObject, name: string): string | null {
  const direct = object[`${ATTR_PREFIX}${name}`];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  // After removeNSPrefix, xml:lang becomes lang; keep a fallback lookup.
  if (name.includes(":")) {
    const local = name.slice(name.indexOf(":") + 1);
    return attributeOf(object, local);
  }
  return null;
}

function asArray(value: XmlValue | undefined): XmlValue[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function asObject(value: XmlValue | undefined): XmlObject | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function firstObject(value: XmlValue | undefined): XmlObject | null {
  for (const entry of asArray(value)) {
    const object = asObject(entry);
    if (object) {
      return object;
    }
  }
  return null;
}

function hasOwn(object: XmlObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
