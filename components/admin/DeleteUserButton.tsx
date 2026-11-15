"use client";

import { useState, useTransition } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** "Delete" with a confirmation warning. The server action does the actual deletion. */
export function DeleteUserButton({ action, userId, name, username }: { action: (fd: FormData) => Promise<void>; userId: string; name: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      try {
        await action(fd);
        toast.success(`${name} was deleted.`);
        setOpen(false);
      } catch {
        toast.error("Couldn't delete this user. Try again.");
      }
    });

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${username}`} />}>
        <Trash2 /> Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>{username}</strong> and everything they own: flashcard progress and answers, feedback they submitted, and their assistant chats. It cannot be undone. To only block
            access, use Disable instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending} data-testid="confirm-delete-user">
            {pending ? <Spinner /> : <Trash2 />} Delete user
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
