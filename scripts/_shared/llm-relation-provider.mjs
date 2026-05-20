import { validateExtractedRelations } from './relation-extractor.mjs';
import { getPolicyValue, loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function estimateTokens(text, policy) {
  const divisor = Math.max(1, requirePolicyNumber(policy, 'relationExtraction.estimatedPromptTokenDivisor'));
  return Math.ceil(String(text || '').length / divisor);
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty LLM response');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('LLM response did not contain a JSON object');
  }
}

export function shouldUseApiLlm(policy = loadResearchOsPolicy(), options = {}) {
  if (options.useLlm === false) return false;
  if (options.useLlm === true) return true;
  if (process.env.RESEARCH_OS_ENABLE_LLM === '1') return true;
  return getPolicyValue(policy, 'relationExtraction.enableApiLlm') === true;
}

export function buildRelationExtractionPrompt(bundle = {}, question = {}) {
  const themes = Array.isArray(question.themes) ? question.themes.join(', ') : '';
  return [
    'You extract candidate industrial knowledge-graph relations for an evidence-first research system.',
    'Return only JSON with shape {"relations":[...]}.',
    'Allowed relation values: requires, supplies, bottleneck, beneficiary, substitute, adjacent_to, exposed_to, enables, risk_to, uses, manufactures, depends_on.',
    'Allowed node types: theme, technology, component, material, process, infrastructure, supplier, company, symbol, source.',
    'Rules: every high-confidence relation needs a short evidenceQuote from the provided text; do not infer supplier links unless the evidence directly supports them; candidate-only output.',
    `Question themes: ${themes}`,
    `Research prompt: ${compact(question.prompt)}`,
    `Title: ${compact(bundle.title)}`,
    `Excerpt: ${compact(bundle.text_excerpt || bundle.textExcerpt)}`,
    `Source metadata: ${JSON.stringify(bundle.metadata || {})}`,
  ].join('\n');
}

export async function checkLlmTokenBudget(queryable, estimatedTokens, policy = loadResearchOsPolicy()) {
  const dailyLimit = requirePolicyNumber(policy, 'automation.llmTokenBudgetDaily');
  const { rows } = await queryable.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS used
       FROM automation_budget_log
      WHERE action = 'researchOsLlmTokens'
        AND consumed_at >= NOW() - INTERVAL '1 day'`,
  );
  const used = Number(rows[0]?.used || 0);
  return {
    allowed: used + estimatedTokens <= dailyLimit,
    used,
    estimatedTokens,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - used),
  };
}

export async function logLlmTokenUse(queryable, amount, metadata = {}) {
  await queryable.query(
    `INSERT INTO automation_budget_log (action, amount, metadata)
     VALUES ('researchOsLlmTokens', $1, $2::jsonb)`,
    [Math.max(0, Math.ceil(Number(amount || 0))), JSON.stringify(metadata)],
  );
}

async function callOllama(prompt, policy) {
  const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.RESEARCH_OS_LLM_MODEL || getPolicyValue(policy, 'relationExtraction.llmModel');
  if (!model) throw new Error('missing relationExtraction.llmModel or RESEARCH_OS_LLM_MODEL for Ollama relation extraction');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: {
        temperature: requirePolicyNumber(policy, 'relationExtraction.temperature'),
        num_predict: requirePolicyNumber(policy, 'relationExtraction.maxOutputTokens'),
      },
      messages: [
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama relation extraction failed: HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.message?.content || payload?.response || '';
}

async function callOpenAi(prompt, policy) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.RESEARCH_OS_LLM_MODEL || getPolicyValue(policy, 'relationExtraction.llmModel');
  if (!apiKey) throw new Error('missing OPENAI_API_KEY for OpenAI relation extraction');
  if (!model) throw new Error('missing relationExtraction.llmModel or RESEARCH_OS_LLM_MODEL for OpenAI relation extraction');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Return strict JSON only.' }] },
        { role: 'user', content: [{ type: 'input_text', text: prompt }] },
      ],
      temperature: requirePolicyNumber(policy, 'relationExtraction.temperature'),
      max_output_tokens: requirePolicyNumber(policy, 'relationExtraction.maxOutputTokens'),
    }),
  });
  if (!response.ok) throw new Error(`OpenAI relation extraction failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.output_text === 'string') return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || '')
    .join('\n');
}

export async function extractRelationsWithApiLlm({ queryable, bundle, question, policy = loadResearchOsPolicy(), llmExtractor } = {}) {
  const prompt = buildRelationExtractionPrompt(bundle, question);
  const estimatedInputTokens = estimateTokens(prompt, policy);
  const estimatedOutputTokens = requirePolicyNumber(policy, 'relationExtraction.maxOutputTokens');
  const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;
  const budget = queryable
    ? await checkLlmTokenBudget(queryable, estimatedTokens, policy)
    : { allowed: true, estimatedTokens };
  if (!budget.allowed) {
    return {
      ok: false,
      skipped: true,
      reason: 'llm token budget exhausted',
      budget,
      accepted: [],
      rejected: [],
    };
  }
  const provider = process.env.RESEARCH_OS_LLM_PROVIDER || getPolicyValue(policy, 'relationExtraction.llmProvider') || 'disabled';
  if (provider === 'disabled' && !llmExtractor) {
    return {
      ok: false,
      skipped: true,
      reason: 'LLM provider disabled',
      budget,
      accepted: [],
      rejected: [],
    };
  }
  const raw = llmExtractor
    ? await llmExtractor({ prompt, bundle, question, policy })
    : provider === 'ollama'
      ? await callOllama(prompt, policy)
      : provider === 'openai'
        ? await callOpenAi(prompt, policy)
        : (() => { throw new Error(`unsupported research relation LLM provider: ${provider}`); })();
  const parsed = parseJsonObject(raw);
  const validation = validateExtractedRelations(parsed, {
    policy,
    quoteLessConfidenceMax: requirePolicyNumber(policy, 'relationExtraction.quoteLessConfidenceMax'),
  });
  if (queryable) {
    await logLlmTokenUse(queryable, estimatedTokens, {
      provider,
      model: process.env.RESEARCH_OS_LLM_MODEL || getPolicyValue(policy, 'relationExtraction.llmModel') || null,
      bundleId: bundle.id,
      questionId: question.id,
      accepted: validation.accepted.length,
      rejected: validation.rejected.length,
    });
  }
  return {
    ok: true,
    skipped: false,
    provider,
    budget,
    rawTokenEstimate: estimatedTokens,
    accepted: validation.accepted.map((relation) => ({
      ...relation,
      metadata: {
        ...(relation.metadata || {}),
        extractionMode: 'api-llm',
        provider,
      },
    })),
    rejected: validation.rejected,
  };
}
