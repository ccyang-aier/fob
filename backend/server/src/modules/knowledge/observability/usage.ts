import type { Pool } from 'pg';
import { aiUsage } from '../../../platform/database/resources/schema';
import { fobDatabaseErrorMessage } from '../../../platform/database/initialize-config';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ModelCallRecord } from '../ai/gateway';

/** Only safe call metadata; never SQL errors, provider bodies or credentials. */
export interface UsagePersistFailed {
  type: 'usage_persist_failed';
  callId: string;
  knowledgeBaseId: string;
  operation: ModelCallRecord['operation'];
  status: ModelCallRecord['status'];
  errorCode: string | null;
  cause: string;
}

export type ObservabilityDiagnostic = UsagePersistFailed;

/**
 * Every started gateway call becomes one durable ai_usage row through its own
 * short resource transaction, committed before the call result is returned. The
 * insert is deliberately NOT part of any business write transaction: provider
 * tokens were consumed regardless of whether business writes commit, and a
 * metering outage must not fail an already successful model call. A failed
 * insert is reported once through the diagnostic sink and never thrown.
 */
export function createAiUsageRecorder(pool: Pool, onDiagnostic: (event: ObservabilityDiagnostic) => void) {
  return {
    async persist(record: ModelCallRecord, traceId: string | null): Promise<boolean> {
      try {
        await withKnowledgeBase(pool, record.context.knowledgeBaseId, async (db) => {
          await db.insert(aiUsage).values({
            knowledgeBaseId: record.context.knowledgeBaseId,
            id: record.callId,
            userId: record.context.userId,
            taskId: record.context.taskId ?? null,
            operation: record.operation,
            status: record.status,
            tier: record.tier,
            provider: record.model?.provider ?? null,
            model: record.model?.model ?? null,
            inputTokens: record.usage.inputTokens,
            outputTokens: record.usage.outputTokens,
            durationMs: record.durationMs,
            errorCode: record.errorCode ?? null,
            traceId,
          });
        });
        return true;
      } catch (error) {
        onDiagnostic({
          type: 'usage_persist_failed', callId: record.callId, knowledgeBaseId: record.context.knowledgeBaseId,
          operation: record.operation, status: record.status, errorCode: record.errorCode ?? null,
          cause: fobDatabaseErrorMessage(error),
        });
        return false;
      }
    },
  };
}

export type AiUsageRecorder = ReturnType<typeof createAiUsageRecorder>;
