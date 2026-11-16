"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  PaperclipIcon,
  SquareIcon,
} from "lucide-react";
import {
  Composer,
  ComposerActionGroup,
  ComposerActions,
  ComposerInput,
  ComposerSubmit,
  getComposerText,
  type ComposerValue,
} from "@/components/ui/composer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AttachmentMeta } from "@/lib/types";
import { AttachmentChip } from "./message-item";

export function ComposerBar({
  onSend,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  uploading,
  streaming,
  onStop,
  modelPicker,
  placeholder = "Message Minimi…",
}: {
  onSend: (text: string) => void | Promise<void>;
  attachments: AttachmentMeta[];
  onAttachFiles: (files: FileList) => void | Promise<void>;
  onRemoveAttachment: (id: string) => void;
  uploading: boolean;
  streaming: boolean;
  onStop: () => void;
  modelPicker?: ReactNode;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<ComposerValue>([]);

  function submit(draft: ComposerValue) {
    const text = getComposerText(draft).trim();
    if (!text && attachments.length === 0) return;
    setValue([]);
    void onSend(text);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept=".txt,.md,.markdown,.json,.csv,.log,.pdf,.docx,.html,.htm,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.css,.sql,.toml,.ini,image/*"
        onChange={(event) => {
          const files = event.target.files;
          if (!files?.length) return;
          void Promise.resolve(onAttachFiles(files)).finally(() => {
            event.target.value = "";
          });
        }}
      />
      <Composer
        value={value}
        onValueChange={setValue}
        onSubmit={submit}
        allowEmpty={attachments.length > 0}
        submitDisabled={streaming || uploading}
        className="shadow-lg/5"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {attachments.map((file) => (
              <AttachmentChip
                key={file.id}
                file={file}
                onRemove={() => onRemoveAttachment(file.id)}
              />
            ))}
          </div>
        )}
        <ComposerInput placeholder={placeholder} />
        <ComposerActions>
          <ComposerActionGroup>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Attach files"
              title="Attach files"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Spinner className="size-4" /> : <PaperclipIcon />}
            </Button>
            {modelPicker}
          </ComposerActionGroup>
          <ComposerActionGroup align="end">
            {streaming ? (
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Stop generating"
                onClick={onStop}
              >
                <SquareIcon className="fill-current" />
              </Button>
            ) : (
              <ComposerSubmit
                render={
                  <Button
                    size="icon-sm"
                    aria-label="Send message"
                    disabled={streaming || uploading}
                  />
                }
              >
                <ArrowUpIcon />
              </ComposerSubmit>
            )}
          </ComposerActionGroup>
        </ComposerActions>
      </Composer>
    </div>
  );
}
