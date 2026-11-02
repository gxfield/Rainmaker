import type { Question, Store } from "./db.ts";

export interface Answer {
  answer: string | null;
  by: string | null;
}

/**
 * Questions an agent asks mid-run through the `ask_human` tool. The agent's
 * tool call waits here until someone answers (Hermes over MCP, the dashboard,
 * or a GitHub comment) or the wait times out.
 */
export class Questions {
  readonly #store: Store;
  readonly #waiters = new Map<number, (a: Answer) => void>();

  constructor(store: Store) {
    this.#store = store;
  }

  /** Records the question, calls `onAsked`, and resolves when it's answered, expires, or `signal` aborts. */
  async ask(jobId: number, text: string, timeoutMs: number, signal: AbortSignal | undefined, onAsked: (q: Question) => void): Promise<Answer> {
    const question = this.#store.createQuestion(jobId, text);
    return new Promise<Answer>((resolve) => {
      const finish = (a: Answer) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#waiters.delete(question.id);
        resolve(a);
      };
      const timer = setTimeout(() => {
        this.#store.closeQuestion(question.id, "expired", null, null);
        finish({ answer: null, by: null });
      }, timeoutMs);
      const onAbort = () => {
        this.#store.closeQuestion(question.id, "expired", null, null);
        finish({ answer: null, by: null });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.set(question.id, finish);
      onAsked(question);
    });
  }

  /** Answers a pending question. Returns false if it was already answered or expired. */
  answer(id: number, answer: string, by: string): boolean {
    const text = answer.trim();
    if (!text) throw new Error("The answer is empty");
    if (!this.#store.closeQuestion(id, "answered", text, by)) return false;
    this.#waiters.get(id)?.({ answer: text, by });
    return true;
  }

  pending(): Question[] {
    return this.#store.pendingQuestions();
  }

  /** Expires questions left pending by a restart, since no agent is waiting on them any more. */
  expireOrphans(): void {
    for (const q of this.#store.pendingQuestions()) {
      if (!this.#waiters.has(q.id)) this.#store.closeQuestion(q.id, "expired", null, null);
    }
  }
}
