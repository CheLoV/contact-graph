"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createContactSchema,
  type CreateContactInput,
} from "@/lib/validators/contact";

export function AddContactDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: { displayName: "", phoneNumber: "", email: "", notes: "" },
  });

  const onSubmit = handleSubmit(async (raw) => {
    // Не отправляем пустые опциональные поля
    const body: CreateContactInput = {
      displayName: raw.displayName,
      ...(raw.phoneNumber?.trim() ? { phoneNumber: raw.phoneNumber.trim() } : {}),
      ...(raw.email?.trim() ? { email: raw.email.trim() } : {}),
      ...(raw.notes?.trim() ? { notes: raw.notes.trim() } : {}),
    };

    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      const message = json?.error?.message ?? "Не удалось создать контакт";
      toast.error(message);
      if (json?.error?.code === "VALIDATION_ERROR") {
        setError("displayName", { type: "server", message });
      }
      return;
    }

    toast.success("Контакт добавлен");
    reset();
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-1 h-4 w-4" />
        Добавить контакт
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый контакт</DialogTitle>
          <DialogDescription>
            Минимум — имя. Телефон и email можно добавить сейчас или позже.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Имя</Label>
            <Input
              id="displayName"
              autoComplete="off"
              placeholder="Иван Петров"
              {...register("displayName")}
            />
            {errors.displayName ? (
              <p className="text-xs text-destructive">
                {errors.displayName.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phoneNumber">Телефон</Label>
            <Input
              id="phoneNumber"
              autoComplete="off"
              placeholder="+7 999 123-45-67"
              {...register("phoneNumber")}
            />
            {errors.phoneNumber ? (
              <p className="text-xs text-destructive">
                {errors.phoneNumber.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              autoComplete="off"
              type="email"
              placeholder="ivan@example.com"
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Заметки</Label>
            <Input
              id="notes"
              autoComplete="off"
              placeholder="Опционально"
              {...register("notes")}
            />
            {errors.notes ? (
              <p className="text-xs text-destructive">{errors.notes.message}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
