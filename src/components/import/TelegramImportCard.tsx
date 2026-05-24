"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ImportSourceCard } from "./ImportSourceCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  telegramImportStartResponse,
  telegramImportStatusResponse,
} from "@/lib/validators/import";

type Mode = "api" | "historical" | "all";
type Phase = "idle" | "starting" | "running" | "done" | "error";

const POLL_INTERVAL_MS = 1500;

// Shape of summary returned by the orchestrator. Defined loose because
// the route stores it as JSON-string and parses on read.
type Summary = {
  mode: Mode;
  api?: {
    contactsMergedByPhone: number;
    contactsCreatedFromTelegram: number;
    contactsCreatedNoPhone: number;
    identitiesPromoted: number;
    conflicts: unknown[];
    enrichmentSucceeded: number;
    enrichmentSkippedBots: number;
    enrichmentSkippedAlreadyDone: number;
    enrichmentFailed: number;
    photosDownloaded: number;
    photosSkippedExisting: number;
  } | null;
  chats?: {
    chatsByType: Record<string, number>;
    chatsEnriched: number;
    membersCreated: number;
    membersSkippedUnknownCounterpart: number;
  } | null;
  historical?: {
    jsonEntriesNormalized: number;
    addressbookCreated: number;
    addressbookMergedToExistingContact: number;
    addressbookCreatedNewContact: number;
    addressbookSkippedHasTelegram: number;
  } | null;
};

type Snapshot = {
  status: "pending" | "running" | "done" | "failed";
  currentPhase: string | null;
  total: number;
  processed: number;
  summary: Summary | null;
};

const PHASE_LABEL: Record<string, string> = {
  pending: "Запуск",
  phase_1_me: "Фаза 1/6: Me",
  phase_2_contacts: "Фаза 2/6: Контакты",
  phase_3_enrichment: "Фаза 3/6: Обогащение профилей",
  phase_4_dialogs: "Фаза 4/6: Диалоги",
  phase_5b_chat_enrichment: "Фаза 5/6: Метаданные групп",
  phase_5c_direct_members: "Фаза 5/6: Участники личных чатов",
  phase_6_historical: "Фаза 6/6: Исторические из JSON",
  done: "Готово",
  crashed: "Ошибка",
};

function labelFor(phase: string | null): string {
  if (!phase) return "Подготовка…";
  return PHASE_LABEL[phase] ?? phase;
}

export function TelegramImportCard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("all");
  const [phase, setPhase] = useState<Phase>("idle");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const reset = () => {
    stopPolling();
    setPhase("idle");
    setSnapshot(null);
    setErrorMsg(null);
  };

  const start = async () => {
    setPhase("starting");
    setErrorMsg(null);
    setSnapshot(null);

    let jobId: string;
    try {
      const res = await fetch("/api/import/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const raw: unknown = await res.json();
      const parsed = telegramImportStartResponse.safeParse(raw);
      if (!parsed.success || !parsed.data.ok) {
        const msg =
          parsed.success && !parsed.data.ok
            ? parsed.data.error.message
            : "Не удалось разобрать ответ сервера";
        setErrorMsg(msg);
        setPhase("error");
        return;
      }
      jobId = parsed.data.data.jobId;
    } catch {
      setErrorMsg("Сетевая ошибка при старте импорта");
      setPhase("error");
      return;
    }

    setPhase("running");
    setSnapshot({
      status: "running",
      currentPhase: "pending",
      total: 0,
      processed: 0,
      summary: null,
    });

    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/import/telegram?jobId=${encodeURIComponent(jobId)}`,
        );
        const raw: unknown = await r.json();
        const parsed = telegramImportStatusResponse.safeParse(raw);
        if (!parsed.success || !parsed.data.ok) {
          stopPolling();
          const msg =
            parsed.success && !parsed.data.ok
              ? parsed.data.error.message
              : "Не удалось получить статус импорта";
          setErrorMsg(msg);
          setPhase("error");
          return;
        }
        const snap = parsed.data.data;
        setSnapshot({
          status: snap.status,
          currentPhase: snap.currentPhase,
          total: snap.total,
          processed: snap.processed,
          summary: (snap.summary as Summary | null) ?? null,
        });
        if (snap.status === "done") {
          stopPolling();
          setPhase("done");
          toast.success("Telegram импорт завершён");
          router.refresh();
        } else if (snap.status === "failed") {
          stopPolling();
          setPhase("error");
          setErrorMsg("Импорт упал. Подробности — в карточке.");
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_INTERVAL_MS);
  };

  const pct =
    snapshot && snapshot.total > 0
      ? Math.round((snapshot.processed / snapshot.total) * 100)
      : 0;

  return (
    <ImportSourceCard
      icon={Send}
      title="Telegram"
      description="MTProto API + JSON-экспорт (адресная книга + чаты)"
    >
      <div className="space-y-4">
        {phase === "idle" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Режим импорта</legend>
            {(
              [
                ["all", "Всё (API + исторические из JSON)"],
                ["api", "Только API (контакты + чаты)"],
                ["historical", "Только JSON-исторические"],
              ] as Array<[Mode, string]>
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="telegram-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {phase === "starting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Старт импорта…
          </div>
        )}

        {phase === "running" && snapshot && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{labelFor(snapshot.currentPhase)}</span>
              <span className="text-muted-foreground tabular-nums">
                {snapshot.processed} / {snapshot.total}
              </span>
            </div>
            <Progress value={pct} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Импорт идёт в фоне. Можно закрыть вкладку — он не остановится.
            </div>
          </div>
        )}

        {phase === "done" && snapshot && snapshot.summary && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Telegram импорт завершён</AlertTitle>
            <AlertDescription>
              <SummaryView summary={snapshot.summary} />
              <div className="mt-3 flex gap-2">
                <Link
                  href="/contacts"
                  className={buttonVariants({ size: "sm" })}
                >
                  К контактам
                </Link>
                <Link
                  href="/chats"
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  К чатам
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                >
                  Сбросить
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {phase === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Ошибка импорта</AlertTitle>
            <AlertDescription>
              <p>{errorMsg ?? "Неизвестная ошибка"}</p>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reset}
                >
                  Попробовать снова
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {phase === "idle" && (
          <div className="flex justify-end">
            <Button type="button" onClick={start}>
              Запустить импорт
            </Button>
          </div>
        )}
      </div>
    </ImportSourceCard>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-2 text-sm">
      {summary.api && (
        <div>
          <div className="font-medium">Контакты</div>
          <ul className="ml-4 list-disc text-xs text-muted-foreground space-y-0.5">
            <li>
              Слито с vCard по phone: <strong>{summary.api.contactsMergedByPhone}</strong>
            </li>
            <li>
              Промоут self_reported → imported: <strong>{summary.api.identitiesPromoted}</strong>
            </li>
            <li>
              Создано новых из Telegram: <strong>{summary.api.contactsCreatedFromTelegram}</strong>
            </li>
            <li>
              Без phone: <strong>{summary.api.contactsCreatedNoPhone}</strong>
            </li>
            <li>
              Конфликты (для ручной проверки): <strong>{summary.api.conflicts.length}</strong>
            </li>
            <li>
              Обогащено: <strong>{summary.api.enrichmentSucceeded}</strong>, фото:{" "}
              <strong>{summary.api.photosDownloaded}</strong>
            </li>
          </ul>
        </div>
      )}
      {summary.chats && (
        <div>
          <div className="font-medium">Чаты</div>
          <ul className="ml-4 list-disc text-xs text-muted-foreground space-y-0.5">
            {Object.entries(summary.chats.chatsByType).map(([type, count]) => (
              <li key={type}>
                {type}: <strong>{count}</strong>
              </li>
            ))}
            <li>
              Обогащено (group/channel): <strong>{summary.chats.chatsEnriched}</strong>
            </li>
            <li>
              ChatMember (direct + self): <strong>{summary.chats.membersCreated}</strong>
            </li>
          </ul>
        </div>
      )}
      {summary.historical && (
        <div>
          <div className="font-medium">Исторические (JSON)</div>
          <ul className="ml-4 list-disc text-xs text-muted-foreground space-y-0.5">
            <li>
              Создано telegram_addressbook: <strong>{summary.historical.addressbookCreated}</strong>
            </li>
            <li>
              Прицеплено к существующим Contact:{" "}
              <strong>{summary.historical.addressbookMergedToExistingContact}</strong>
            </li>
            <li>
              Создано новых Contact:{" "}
              <strong>{summary.historical.addressbookCreatedNewContact}</strong>
            </li>
            <li>
              Пропущено (уже есть telegram identity):{" "}
              <strong>{summary.historical.addressbookSkippedHasTelegram}</strong>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
