#!/usr/bin/env python3
"""Fetch configured RSS/Atom feeds and write a compact static-site payload."""

import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES_FILE = ROOT / "sources.json"
OUTPUT_FILE = ROOT / "site" / "feeds.json"
MAX_ITEMS_PER_SOURCE = 40
MAX_DESCRIPTION_LENGTH = 280


def text_content(element):
    if element is None:
        return ""
    return " ".join("".join(element.itertext()).split())


def atom_child(item, name):
    return item.find(f"{{http://www.w3.org/2005/Atom}}{name}")


def item_value(item, rss_name, atom_name=None):
    value = item.find(rss_name)
    if value is not None:
        return text_content(value)
    if atom_name:
        atom_value = atom_child(item, atom_name)
        if atom_name == "link" and atom_value is not None:
            return atom_value.attrib.get("href", "")
        return text_content(atom_value)
    return ""


def parse_items(root, source):
    entries = root.findall(".//item")
    if not entries:
        entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    parsed = []
    for entry in entries[:MAX_ITEMS_PER_SOURCE]:
        title = item_value(entry, "title", "title")
        link = item_value(entry, "link", "link")
        if not title or not link or not link.startswith(("https://", "http://")):
            continue

        description = item_value(entry, "description") or item_value(entry, "summary", "summary")
        description = re.sub(r"<[^>]*>", " ", unescape(description))
        description = " ".join(description.split())[:MAX_DESCRIPTION_LENGTH]
        published = (
            item_value(entry, "pubDate")
            or item_value(entry, "published", "published")
            or item_value(entry, "updated", "updated")
        )
        parsed.append({
            "title": title,
            "url": link,
            "published": published,
            "description": description,
            "sourceId": source["id"],
            "sourceName": source["name"],
        })
    return parsed


def fetch_source(source):
    request = urllib.request.Request(
        source["url"],
        headers={"User-Agent": "Rubrik/1.0 (+RSS news reader)"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        root = ET.fromstring(response.read())
    return parse_items(root, source)


def sort_key(article):
    published = article["published"]
    try:
        date = datetime.fromisoformat(published.replace("Z", "+00:00"))
    except ValueError:
        try:
            date = parsedate_to_datetime(published)
        except (TypeError, ValueError, OverflowError):
            return datetime.min.replace(tzinfo=timezone.utc)
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc)


def main():
    sources = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    articles = []
    errors = []

    for source in sources:
        try:
            items = fetch_source(source)
            articles.extend(items)
            print(f"{source['name']}: {len(items)} artiklar")
        except (urllib.error.URLError, ET.ParseError, TimeoutError, ValueError) as error:
            errors.append({"sourceId": source["id"], "message": str(error)[:180]})
            print(f"{source['name']}: kunde inte hämtas ({error})", file=sys.stderr)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=7)
    articles = [article for article in articles if cutoff <= sort_key(article) <= now]
    articles.sort(key=sort_key, reverse=True)
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "id": source["id"],
                "name": source["name"],
                "home": source["home"],
                "feedUrl": source["url"],
            }
            for source in sources
        ],
        "articles": articles,
        "errors": errors,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Totalt: {len(articles)} artiklar från {len(sources) - len(errors)}/{len(sources)} källor")

    return 1 if len(errors) == len(sources) else 0


if __name__ == "__main__":
    raise SystemExit(main())