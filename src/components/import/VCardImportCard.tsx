"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { ImportSourceCard } from "./ImportSourceCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  MAX_FILES_PER_IMPORT,
  importStartResponse,
  importStatusResponse,
} from "@/lib/validators/import";
import { cn } from "@/lib/utils";

type Phase = "idle" | "uploading" | "importing" | "done" | "error";

type JobSnapshot = {
  status: "pending" | "running" | "done" | "failed";
  total: number;
  processed: number;
};

const POLL_INTERVAL_MS = 500;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function VCardImportCard() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) =>
      f.name.toLowerCase().endsWith(".vcf"),
    );
    if (arr.length === 0) {
      toast.error("Выберите .vcf файлы");
      return;
    }
    setFiles((prev) => {
      const merged = [...prev, ...arr];
      if (merged.length > MAX_FILES_PER_IMPORT) {
        toast.error(`Не больше ${MAX_FILES_PER_IMPORT} файлов за раз`);
        return merged.slice(0, MAX_FILES_PER_IMPORT);
      }
      return merged;
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    stopPolling();
    setFiles([]);
    setPhase("idle");
    setSnapshot(null);
    setErrorMsg(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const startImport = async () => {
    setPhase("uploading");
    setErrorMsg(null);
    setSnapshot(null);

    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    let jobId: string;
    let totalParsed: number;
    try {
      const res = await fetch("/api/import/vcard", {
        method: "POST",
        body: fd,
      });
      const raw: unknown = await res.json();
      const parsed = importStartResponse.safeParse(raw);
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
      totalParsed = parsed.data.data.totalParsed;
    } catch {
      setErrorMsg("Сетевая ошибка при отправке файлов");
      setPhase("error");
      return;
    }

    setSnapshot({ status: "running", total: totalParsed, processed: 0 });
    setPhase("importing");

    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/import/vcard?jobId=${encodeURIComponent(jobId)}`,
        );
        const raw: unknown = await r.json();
        const parsed = importStatusResponse.safeParse(raw);
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
          total: snap.total,
          processed: snap.processed,
        });
        if (snap.status === "done") {
          stopPolling();
          setPhase("done");
          toast.success(`Импорт завершён: ${snap.processed} контактов`);
          router.refresh();
        } else if (snap.status === "failed") {
          stopPolling();
          setPhase("error");
          setErrorMsg("Импорт упал. Подробности — в карточке.");
        }
      } catch {
        // транзиентная ошибка сети — продолжаем пуллить
      }
    }, POLL_INTERVAL_MS);
  };

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const progressValue =
    snapshot && snapshot.total > 0
      ? Math.round((snapshot.processed / snapshot.total) * 100)
      : 0;

  return (
    <ImportSourceCard
      icon={Smartphone}
      title="Телефонная книга (vCard)"
      description="Контакты из iPhone, Android, Google Contacts, iCloud (.vcf)"
    >
      <div className="space-y-4">
        {(phase === "idle" || phase === "uploading") && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25",
              phase === "uploading" && "opacity-50",
            )}
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">
              Перетащите .vcf файл сюда
            </p>
            <p className="text-xs text-muted-foreground">
              или выберите вручную (до {MAX_FILES_PER_IMPORT} файлов)
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
              }}
              disabled={phase === "uploading"}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => inputRef.current?.click()}
              disabled={phase === "uploading"}
            >
              Выбрать файлы
            </Button>
          </div>
        )}

        {files.length > 0 && (phase === "idle" || phase === "uploading") && (
          <div className="space-y-1">
            {files.map((f, idx) => (
              <div
                key={`${f.name}-${idx}`}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatSize(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  disabled={phase === "uploading"}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  aria-label="Убрать файл"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Суммарно: {formatSize(totalBytes)}
            </p>
          </div>
        )}

        {phase === "uploading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка и парсинг файлов…
          </div>
        )}

        {phase === "importing" && snapshot && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Импорт в БД</span>
              <span className="text-muted-foreground tabular-nums">
                {snapshot.processed} / {snapshot.total}
              </span>
            </div>
            <Progress value={progressValue} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Это займёт несколько секунд…
            </div>
          </div>
        )}

        {phase === "done" && snapshot && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Импорт завершён</AlertTitle>
            <AlertDescription>
              <p>
                Обработано: <strong>{snapshot.processed}</strong> контактов.
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href="/contacts"
                  className={buttonVariants({ size: "sm" })}
                >
                  К списку контактов
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reset}
                >
                  Импортировать ещё
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

        {(phase === "idle" || phase === "uploading") && files.length > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={startImport}
              disabled={files.length === 0 || phase === "uploading"}
            >
              {phase === "uploading" ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Загрузка…
                </>
              ) : (
                "Импортировать"
              )}
            </Button>
          </div>
        )}
      </div>
    </ImportSourceCard>
  );
}
