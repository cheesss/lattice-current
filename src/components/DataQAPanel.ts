import { Panel } from './Panel';
import {
  askQuestionOverSnapshot,
  refineQuestionOverSnapshotWithCodex,
  type DataQAAnswer,
  type DataQASnapshot,
  type DataQAEvidenceType,
  type DataQAEvidenceLink,
} from '@/services/data-qa';
import { sanitizeUrl } from '@/utils/sanitize';

type DataQAMessageRole = 'system' | 'user' | 'assistant';

export interface DataQAAnswerTelemetry {
  provider: string;
  model: string;
  mode: 'casual' | 'analytical';
  quality: 'pass' | 'augmented' | 'fallback';
  evidenceCount: number;
  contextChars: number;
  cached: boolean;
  truncated: boolean;
}

export interface DataQAAnalyticsPoint {
  timestamp: number;
  provider: string;
  mode: 'casual' | 'analytical';
  quality: 'pass' | 'augmented' | 'fallback';
  evidenceCount: number;
  contextChars: number;
  cached: boolean;
  truncated: boolean;
}

export interface DataQAAnalyticsSnapshot {
  questionCount: number;
  answerCount: number;
  avgEvidencePerAnswer: number;
  avgContextChars: number;
  qualityCounts: Record<'pass' | 'augmented' | 'fallback', number>;
  modeCounts: Record<'casual' | 'analytical', number>;
  providerCounts: Record<string, number>;
  evidenceTypeCounts: Record<DataQAEvidenceType, number>;
  recent: DataQAAnalyticsPoint[];
}

interface DataQAMessage {
  id: number;
  role: DataQAMessageRole;
  text: string;
  meta?: string;
  pending?: boolean;
  evidence?: DataQAEvidenceLink[];
  evidenceFirst?: boolean;
  createdAt: number;
  telemetry?: DataQAAnswerTelemetry;
}

export class DataQAPanel extends Panel {
  private readonly snapshotProvider: () => DataQASnapshot;

  private readonly rootEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly messagesEl: HTMLDivElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly askBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;

  private readonly onSubmitBound: (event: Event) => void;
  private readonly onClearBound: () => void;
  private readonly onKeyDownBound: (event: KeyboardEvent) => void;

  private isSubmitting = false;
  private messageSeq = 1;
  private messages: DataQAMessage[] = [];
  private activeRequestToken = 0;

  constructor(snapshotProvider: () => DataQASnapshot, title = 'Data Q&A') {
    super({
      id: 'data-qa',
      title,
      showCount: true,
      trackActivity: false,
    });

    this.snapshotProvider = snapshotProvider;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'data-qa-root';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'data-qa-stats';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'data-qa-messages';

    this.formEl = document.createElement('form');
    this.formEl.className = 'data-qa-form';

    this.inputEl = document.createElement('textarea');
    this.inputEl.className = 'data-qa-input';
    this.inputEl.placeholder = '현재 로드된 뉴스, 시장, 시위, 항공, 선박, 장애, 지진 데이터를 바탕으로 질문하세요...';
    this.inputEl.rows = 3;
    this.inputEl.maxLength = 5000;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'data-qa-actions';

    this.askBtn = document.createElement('button');
    this.askBtn.type = 'submit';
    this.askBtn.className = 'data-qa-btn data-qa-ask';
    this.askBtn.textContent = '질문하기';

    this.clearBtn = document.createElement('button');
    this.clearBtn.type = 'button';
    this.clearBtn.className = 'data-qa-btn data-qa-clear';
    this.clearBtn.textContent = '대화 초기화';

    actionsEl.append(this.askBtn, this.clearBtn);
    this.formEl.append(this.inputEl, actionsEl);
    this.rootEl.append(this.statsEl, this.messagesEl, this.formEl);
    this.content.replaceChildren(this.rootEl);

    this.onSubmitBound = (event: Event) => {
      event.preventDefault();
      void this.submitQuestion();
    };
    this.onClearBound = () => this.clearConversation();
    this.onKeyDownBound = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.submitQuestion();
      }
    };

    this.formEl.addEventListener('submit', this.onSubmitBound);
    this.clearBtn.addEventListener('click', this.onClearBound);
    this.inputEl.addEventListener('keydown', this.onKeyDownBound);

    this.pushMessage(
      'system',
      '현재 로드된 Lattice Current 데이터를 기준으로 답변합니다. 빠르게 보내려면 Ctrl+Enter를 사용하세요.',
    );
    this.refreshSnapshot();
  }

  public refreshSnapshot(): void {
    const snapshot = this.snapshotProvider();
    const totalRecords = snapshot.counts.news
      + snapshot.counts.clusters
      + snapshot.counts.markets
      + snapshot.counts.predictions
      + snapshot.counts.protests
      + snapshot.counts.outages
      + snapshot.counts.flights
      + snapshot.counts.vessels
      + snapshot.counts.earthquakes;

    this.setCount(totalRecords);

    const updated = new Date(snapshot.generatedAt);
    const updatedText = Number.isFinite(updated.getTime())
      ? updated.toLocaleTimeString()
      : '--:--:--';
    this.statsEl.textContent =
      `UPDATED ${updatedText} | NEWS ${snapshot.counts.news} | CLUSTERS ${snapshot.counts.clusters} | `
      + `MKT ${snapshot.counts.markets} | PRED ${snapshot.counts.predictions} | `
      + `PROTEST ${snapshot.counts.protests} | OUTAGE ${snapshot.counts.outages} | `
      + `FLIGHT ${snapshot.counts.flights} | VESSEL ${snapshot.counts.vessels}`;
  }

  private clearConversation(): void {
    this.activeRequestToken += 1;
    this.messages = [];
    this.messageSeq = 1;
    this.pushMessage(
      'system',
      '대화를 초기화했습니다. 최신 스냅샷 기준으로 다시 질문하세요.',
    );
  }

  private setSubmitting(next: boolean): void {
    this.isSubmitting = next;
    this.askBtn.disabled = next;
    this.inputEl.disabled = next;
    this.askBtn.textContent = next ? '분석 중...' : '질문하기';
  }

  private pushMessage(
    role: DataQAMessageRole,
    text: string,
    meta?: string,
    pending = false,
    evidence?: DataQAEvidenceLink[],
    evidenceFirst = false,
    telemetry?: DataQAAnswerTelemetry,
  ): number {
    const id = this.messageSeq;
    this.messageSeq += 1;
    this.messages.push({ id, role, text, meta, pending, evidence, evidenceFirst, telemetry, createdAt: Date.now() });
    this.renderMessages();
    return id;
  }

  private updateMessage(id: number, next: Partial<Omit<DataQAMessage, 'id' | 'role'>>): void {
    const target = this.messages.find(message => message.id === id);
    if (!target) return;
    if (typeof next.text === 'string') target.text = next.text;
    if (typeof next.meta === 'string' || next.meta === undefined) target.meta = next.meta;
    if (typeof next.pending === 'boolean') target.pending = next.pending;
    if (next.evidence !== undefined) target.evidence = next.evidence;
    if (typeof next.evidenceFirst === 'boolean') target.evidenceFirst = next.evidenceFirst;
    if (next.telemetry !== undefined) target.telemetry = next.telemetry;
    if (typeof next.createdAt === 'number' && Number.isFinite(next.createdAt)) target.createdAt = next.createdAt;
    this.renderMessages();
  }

  public getAnalyticsSnapshot(maxRecent = 12): DataQAAnalyticsSnapshot {
    const questionCount = this.messages.filter(message => message.role === 'user').length;
    const answerMessages = this.messages.filter(
      message => message.role === 'assistant' && !message.pending && !!message.telemetry,
    );
    const answerCount = answerMessages.length;

    const qualityCounts: DataQAAnalyticsSnapshot['qualityCounts'] = {
      pass: 0,
      augmented: 0,
      fallback: 0,
    };
    const modeCounts: DataQAAnalyticsSnapshot['modeCounts'] = {
      casual: 0,
      analytical: 0,
    };
    const providerCounts: Record<string, number> = {};
    const evidenceTypeCounts: DataQAAnalyticsSnapshot['evidenceTypeCounts'] = {
      news: 0,
      cluster: 0,
      market: 0,
      prediction: 0,
      outage: 0,
      protest: 0,
      earthquake: 0,
      flight: 0,
      vessel: 0,
      multimodal: 0,
    };

    let totalEvidence = 0;
    let totalContextChars = 0;

    for (const message of answerMessages) {
      const telemetry = message.telemetry;
      if (!telemetry) continue;
      qualityCounts[telemetry.quality] += 1;
      modeCounts[telemetry.mode] += 1;
      providerCounts[telemetry.provider] = (providerCounts[telemetry.provider] ?? 0) + 1;
      totalEvidence += telemetry.evidenceCount;
      totalContextChars += telemetry.contextChars;
      for (const evidence of message.evidence ?? []) {
        evidenceTypeCounts[evidence.type] += 1;
      }
    }

    const recent = answerMessages
      .slice(-Math.max(1, maxRecent))
      .map((message): DataQAAnalyticsPoint | null => {
        if (!message.telemetry) return null;
        return {
          timestamp: message.createdAt,
          provider: message.telemetry.provider,
          mode: message.telemetry.mode,
          quality: message.telemetry.quality,
          evidenceCount: message.telemetry.evidenceCount,
          contextChars: message.telemetry.contextChars,
          cached: message.telemetry.cached,
          truncated: message.telemetry.truncated,
        };
      })
      .filter((entry): entry is DataQAAnalyticsPoint => !!entry);

    return {
      questionCount,
      answerCount,
      avgEvidencePerAnswer: answerCount > 0 ? totalEvidence / answerCount : 0,
      avgContextChars: answerCount > 0 ? totalContextChars / answerCount : 0,
      qualityCounts,
      modeCounts,
      providerCounts,
      evidenceTypeCounts,
      recent,
    };
  }

  private renderMessages(): void {
    this.messagesEl.innerHTML = '';

    const fragment = document.createDocumentFragment();
    for (const message of this.messages) {
      const rowEl = document.createElement('div');
      rowEl.className = `data-qa-msg data-qa-msg-${message.role}${message.pending ? ' pending' : ''}`;

      const roleEl = document.createElement('div');
      roleEl.className = 'data-qa-msg-role';
      roleEl.textContent = message.role === 'user' ? 'YOU' : message.role === 'assistant' ? 'LLM' : 'SYSTEM';

      const bodyEl = document.createElement('div');
      bodyEl.className = 'data-qa-msg-body';
      bodyEl.textContent = message.text;

      rowEl.append(roleEl, bodyEl);

      if (message.meta) {
        const metaEl = document.createElement('div');
        metaEl.className = 'data-qa-msg-meta';
        metaEl.textContent = message.meta;
        rowEl.append(metaEl);
      }

      if (message.evidence && message.evidence.length > 0) {
        const evidenceWrap = document.createElement('div');
        evidenceWrap.className = 'data-qa-evidence';

        const evidenceTitle = document.createElement('div');
        evidenceTitle.className = 'data-qa-evidence-title';
        evidenceTitle.textContent = '근거 링크';
        evidenceWrap.append(evidenceTitle);

        const evidenceList = document.createElement('ul');
        evidenceList.className = 'data-qa-evidence-list';

        for (const ev of message.evidence) {
          const li = document.createElement('li');
          li.className = 'data-qa-evidence-item';

          const typeChip = document.createElement('span');
          typeChip.className = `data-qa-evidence-type data-qa-evidence-type-${ev.type}`;
          typeChip.textContent = ev.type.toUpperCase();
          li.append(typeChip);

          const safeHref = sanitizeUrl(ev.url);
          if (safeHref) {
            const linkEl = document.createElement('a');
            linkEl.className = 'data-qa-evidence-link';
            linkEl.href = safeHref;
            linkEl.target = '_blank';
            linkEl.rel = 'noopener noreferrer';
            linkEl.textContent = ev.label;
            li.append(linkEl);
          } else {
            const labelEl = document.createElement('span');
            labelEl.className = 'data-qa-evidence-link';
            labelEl.textContent = ev.label;
            li.append(labelEl);
          }

          if (ev.note) {
            const noteEl = document.createElement('span');
            noteEl.className = 'data-qa-evidence-note';
            noteEl.textContent = ev.note;
            li.append(noteEl);
          }

          evidenceList.append(li);
        }

        evidenceWrap.append(evidenceList);
        rowEl.append(evidenceWrap);
      }

      fragment.append(rowEl);
    }

    this.messagesEl.append(fragment);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private buildTelemetry(answer: DataQAAnswer): DataQAAnswerTelemetry {
    return {
      provider: answer.provider,
      model: answer.model,
      mode: answer.mode,
      quality: answer.quality,
      evidenceCount: answer.evidence.length,
      contextChars: answer.contextChars,
      cached: answer.cached,
      truncated: answer.truncated,
    };
  }

  private buildAnswerMeta(answer: DataQAAnswer): string {
    return [
      `${answer.provider.toUpperCase()} | ${answer.model}`,
      answer.cached ? 'CACHED' : 'LIVE',
      `MODE ${answer.mode.toUpperCase()}`,
      `QUALITY ${answer.quality.toUpperCase()}`,
      `CTX ${answer.contextChars.toLocaleString()} CHARS`,
      answer.truncated ? 'TRUNCATED' : 'FULL',
      `EVID ${answer.evidence.length}`,
    ].join(' | ');
  }

  private shouldRequestRefinement(answer: DataQAAnswer): boolean {
    if (answer.mode === 'casual') return false;
    if (
      (answer.provider === 'codex' || answer.provider === 'ollama')
      && answer.quality === 'pass'
      && answer.evidence.length >= 3
    ) {
      return false;
    }
    if (answer.provider === 'snapshot') return true;
    if (answer.truncated) return true;
    if (answer.quality !== 'pass') return true;
    if (answer.evidence.length < 3) return true;
    if (answer.answer.trim().length < 260) return true;
    return false;
  }

  private async refineAnswerWithCodex(
    requestToken: number,
    messageId: number,
    question: string,
    snapshot: DataQASnapshot,
  ): Promise<void> {
    const current = this.messages.find(message => message.id === messageId);
    if (!current || current.role !== 'assistant') return;

    this.updateMessage(messageId, {
      meta: `${current.meta ?? 'SNAPSHOT'} | CODEX PENDING`,
    });

    try {
      const refined = await refineQuestionOverSnapshotWithCodex(question, snapshot);
      if (!refined || requestToken !== this.activeRequestToken) {
        const latest = this.messages.find(message => message.id === messageId);
        if (latest) {
          this.updateMessage(messageId, {
            meta: (latest.meta ?? '').replace(/\s*\|\s*CODEX PENDING$/, ''),
          });
        }
        return;
      }

      this.updateMessage(messageId, {
        text: refined.answer,
        meta: `${this.buildAnswerMeta(refined)} | REFINED`,
        pending: false,
        evidence: refined.evidence,
        telemetry: this.buildTelemetry(refined),
        createdAt: Date.now(),
      });
    } catch {
      if (requestToken !== this.activeRequestToken) return;
      const latest = this.messages.find(message => message.id === messageId);
      if (!latest) return;
      this.updateMessage(messageId, {
        meta: (latest.meta ?? '').replace(/\s*\|\s*CODEX PENDING$/, ''),
      });
    }
  }

  private async submitQuestion(): Promise<void> {
    if (this.isSubmitting) return;

    const question = this.inputEl.value.trim();
    if (!question) return;

    this.inputEl.value = '';
    this.pushMessage('user', question);
    const pendingId = this.pushMessage('assistant', 'Analyzing current snapshot...', undefined, true);
    this.updateMessage(pendingId, { text: '현재 스냅샷을 분석 중입니다...' });
    const requestToken = ++this.activeRequestToken;
    this.setSubmitting(true);

    try {
      const snapshot = this.snapshotProvider();
      const answer = await askQuestionOverSnapshot(question, snapshot);
      if (requestToken !== this.activeRequestToken) return;

      if (!answer) {
        this.updateMessage(
          pendingId,
          {
            text: '응답을 생성하지 못했습니다. AI 설정(Codex Login/OpenAI/Groq/Ollama)을 확인한 뒤 다시 시도하세요.',
            meta: 'NO_PROVIDER',
            pending: false,
          },
        );
      } else {
        const finishedAt = Date.now();
        const telemetry = this.buildTelemetry(answer);
        const meta = this.buildAnswerMeta(answer);
        this.updateMessage(
          pendingId,
          {
            text: answer.answer,
            meta,
            pending: false,
            evidence: answer.evidence,
            telemetry,
            createdAt: finishedAt,
          },
        );

        if (this.shouldRequestRefinement(answer)) {
          void this.refineAnswerWithCodex(requestToken, pendingId, question, snapshot);
        }
      }
    } catch (error) {
      if (requestToken !== this.activeRequestToken) return;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.updateMessage(
        pendingId,
        {
          text: `요청 처리에 실패했습니다: ${message}`,
          meta: 'ERROR',
          pending: false,
        },
      );
    } finally {
      this.setSubmitting(false);
      this.refreshSnapshot();
      this.inputEl.focus();
    }
  }

  public override destroy(): void {
    this.formEl.removeEventListener('submit', this.onSubmitBound);
    this.clearBtn.removeEventListener('click', this.onClearBound);
    this.inputEl.removeEventListener('keydown', this.onKeyDownBound);
    super.destroy();
  }
}
