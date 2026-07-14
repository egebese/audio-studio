import { describe, expect, it } from "vitest";
import {
  findMentionedTargets,
  insertMention,
  mentionQueryAtCaret,
  replaceMentionsWithAudioTags,
  stripUnknownMentionMarkers
} from "./mentions";

const voices = [
  { id: "v1", name: "Warm Narrator" },
  { id: "v2", name: "Warm Narrator Deep" },
  { id: "v3", name: "Kai" }
];

describe("findMentionedTargets", () => {
  it("finds mentions with spaces and keeps first-appearance order", () => {
    const text = 'Then @Kai answers @Warm Narrator calmly.';
    expect(findMentionedTargets(text, voices).map((voice) => voice.id)).toEqual(["v3", "v1"]);
  });

  it("prefers the longest matching name", () => {
    const text = "Intro by @Warm Narrator Deep tonight.";
    expect(findMentionedTargets(text, voices).map((voice) => voice.id)).toEqual(["v2"]);
  });

  it("ignores unknown mentions and email-like text", () => {
    expect(findMentionedTargets("mail me@example.com about @Nobody", voices)).toEqual([]);
  });

  it("does not select known aliases inside email-like text", () => {
    expect(findMentionedTargets("mail me@Kai.com", voices)).toEqual([]);
  });

  it("does not match a name inside a longer word", () => {
    expect(findMentionedTargets("@Kaiser speaks", voices)).toEqual([]);
  });

  it("dedupes repeated mentions and caps at three", () => {
    const many = [...voices, { id: "v4", name: "Ana" }];
    const text = "@Kai @Kai @Ana @Warm Narrator @Warm Narrator Deep";
    expect(findMentionedTargets(text, many)).toHaveLength(3);
  });

  it("uses the first target when normalized names are duplicated", () => {
    const duplicates = [
      { id: "first", name: " Kai " },
      { id: "second", name: "kai" }
    ];
    expect(findMentionedTargets("@KAI speaks, then @kai exits.", duplicates)).toEqual([
      duplicates[0]
    ]);
  });
});

describe("replaceMentionsWithAudioTags", () => {
  it("rewrites mentions to @AudioN in target order", () => {
    const targets = [voices[2], voices[0]];
    expect(replaceMentionsWithAudioTags("@Kai greets @Warm Narrator.", targets)).toBe(
      "@Audio1 greets @Audio2."
    );
  });

  it("does not rewrite known aliases inside email-like text", () => {
    expect(replaceMentionsWithAudioTags("mail me@Kai.com; ask @Kai.", [voices[2]])).toBe(
      "mail me@Kai.com; ask @Audio1."
    );
  });

  it("does not cascade generated positional tags into later replacements", () => {
    const targets = [
      { id: "long", name: "Audio2 Extended" },
      { id: "reserved", name: "Audio1" }
    ];
    expect(
      replaceMentionsWithAudioTags("@Audio2 Extended greets @Audio1.", targets)
    ).toBe("@Audio1 greets @Audio2.");
  });

  it("keeps replacement aligned to the first duplicate target name", () => {
    const duplicates = [
      { id: "first", name: " Kai " },
      { id: "second", name: "kai" },
      { id: "third", name: "Ana" }
    ];
    expect(replaceMentionsWithAudioTags("@KAI greets @Ana.", duplicates)).toBe(
      "@Audio1 greets @Audio2."
    );
  });
});

describe("stripUnknownMentionMarkers", () => {
  it("strips unresolved prompt mentions but preserves audio tags and email text", () => {
    expect(
      stripUnknownMentionMarkers("mail me@example.com; @Audio1 answers @Ghost while @Audio2 listens.")
    ).toBe("mail me@example.com; @Audio1 answers Ghost while @Audio2 listens.");
  });
});

describe("mentionQueryAtCaret", () => {
  it("returns the partial query at the caret", () => {
    const text = "Say hi @War";
    expect(mentionQueryAtCaret(text, text.length)).toEqual({ start: 7, text: "War" });
  });

  it("returns null when there is no open mention", () => {
    expect(mentionQueryAtCaret("no mention here", 10)).toBeNull();
    expect(mentionQueryAtCaret("me@example", 10)).toBeNull();
  });
});

describe("insertMention", () => {
  it("reuses existing suffix whitespace", () => {
    const text = "Say hi @War please";
    const query = { start: 7, text: "War" };
    const result = insertMention(text, query, "Warm Narrator");
    expect(result.text).toBe("Say hi @Warm Narrator please");
    expect(result.caret).toBe("Say hi @Warm Narrator ".length);
  });

  it("adds separating whitespace when the suffix has none", () => {
    const text = "Say hi @Warplease";
    const query = { start: 7, text: "War" };
    const result = insertMention(text, query, "Warm Narrator");
    expect(result.text).toBe("Say hi @Warm Narrator please");
    expect(result.caret).toBe("Say hi @Warm Narrator ".length);
  });
});
