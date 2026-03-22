export interface InvestmentFocusContext {
  themeId: string | null;
  region: string | null;
}

type Listener = (context: InvestmentFocusContext) => void;

let currentContext: InvestmentFocusContext = {
  themeId: null,
  region: null,
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener(currentContext);
  }
}

export function getInvestmentFocusContext(): InvestmentFocusContext {
  return { ...currentContext };
}

export function setInvestmentFocusContext(next: Partial<InvestmentFocusContext>): void {
  currentContext = {
    themeId: next.themeId !== undefined ? next.themeId : currentContext.themeId,
    region: next.region !== undefined ? next.region : currentContext.region,
  };
  emit();
}

export function clearInvestmentFocusContext(): void {
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
