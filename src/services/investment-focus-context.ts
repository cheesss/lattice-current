export interface InvestmentFocusContext {
  themeId: string | null;
  region: string | null;
}

type Listener = (context: InvestmentFocusContext) => void;

const INVESTMENT_FOCUS_EVENT = 'wm:investment-focus-changed';

let currentContext: InvestmentFocusContext = {
  themeId: null,
  region: null,
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener(currentContext);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INVESTMENT_FOCUS_EVENT, { detail: { ...currentContext } }));
  }
}

export function getInvestmentFocusContext(): InvestmentFocusContext {
  return { ...currentContext };
}

export function setInvestmentFocusContext(next: Partial<InvestmentFocusContext>): void {
  const merged: InvestmentFocusContext = {
    themeId: next.themeId !== undefined ? next.themeId : currentContext.themeId,
    region: next.region !== undefined ? next.region : currentContext.region,
  };
  if (merged.themeId === currentContext.themeId && merged.region === currentContext.region) {
    return;
  }
  currentContext = merged;
  emit();
}

export function clearInvestmentFocusContext(): void {
  if (currentContext.themeId == null && currentContext.region == null) {
    return;
  }
  currentContext = {
    themeId: null,
    region: null,
  };
  emit();
}

export function subscribeInvestmentFocusContext(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentContext);
  return () => {
    listeners.delete(listener);
  };
}

export const INVESTMENT_FOCUS_EVENT_NAME = INVESTMENT_FOCUS_EVENT;
