export type Severity = "incomplete" | "invalid" | "notice";

/** Every code the engine emits; the interface renders one message per code. */
export const ISSUE_CODES = [
  "abilityAboveMax",
  "abilityOutOfRange",
  "alreadyKnown",
  "choiceMissing",
  "duplicateChoice",
  "featAlreadyTaken",
  "notInList",
  "offData",
  "pointBuyOverBudget",
  "pointBuyUnderBudget",
  "requirementNotMet",
  "subclassNotOffered",
  "subclassUnlockedInPlay",
  "subraceMismatch",
  "swapNotKnown",
  "tooManyLevels",
  "tooManySwaps",
  "unknownBackground",
  "unknownClass",
  "unknownFeat",
  "unknownRace",
  "unknownSlot",
  "unknownSubrace",
  "wrongCount",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** A finding of the rules engine; messages are rendered later from `code` and `params`. */
export type Issue = {
  severity: Severity;
  code: IssueCode;
  character: string;
  level: number | null;
  slot: string | null;
  params: Record<string, string | number>;
};

export type Report = {
  status: "valid" | "incomplete" | "invalid";
  issues: Issue[];
};

/** Builds a report whose status is the worst severity found; notices never change it. */
export function reportFrom(issues: Issue[]): Report {
  const status = issues.some((i) => i.severity === "invalid")
    ? "invalid"
    : issues.some((i) => i.severity === "incomplete")
      ? "incomplete"
      : "valid";
  return { status, issues };
}
