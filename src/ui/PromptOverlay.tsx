import { useEffect, useRef, useState } from 'react';
import { useEngine } from '@/canvas/CanvasContext';
import { FabricPromptArea } from '@/canvas/PromptArea';
import { usePromptStore } from '@/state/promptStore';
import { applyWordStyleDelta } from '@/llm/PromptSyncEngine';
import { tokenizePrompt, wordsToPrompt } from '@/lib/tokenize';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/popover';
import { Button } from './primitives/button';
import { Trash2, RotateCw } from 'lucide-react';

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#2563eb', '#8b5cf6', '#ec4899', '#171717'];

export function PromptOverlay() {
  const engine = useEngine();
  const [editingId, setEditingId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const areas = usePromptStore((s) => s.areas);
  const area = editingId ? areas[editingId] : null;

  // Enter edit mode on double-click of a prompt area.
  useEffect(() => {
    if (!engine) return;
    const { canvas } = engine;
    const onDbl = (opt: { target?: unknown }) => {
      const t = opt.target;
      if (t instanceof FabricPromptArea) {
        t.setEditing(true);
        setEditingId(t.promptAreaId);
      }
    };
    canvas.on('mouse:dblclick', onDbl as never);
    return () => {
      canvas.off('mouse:dblclick', onDbl as never);
    };
  }, [engine]);

  // Glue the overlay to the area's on-screen rectangle.
  useEffect(() => {
    if (!engine || !editingId) return;
    const { canvas } = engine;
    const reposition = () => {
      const obj = canvas
        .getObjects()
        .find((o) => o instanceof FabricPromptArea && o.promptAreaId === editingId) as
        | FabricPromptArea
        | undefined;
      const el = wrapperRef.current;
      if (!obj || !el) return;
      const vt = canvas.viewportTransform;
      const br = obj.getBoundingRect();
      el.style.left = `${br.left * vt[0] + vt[4]}px`;
      el.style.top = `${br.top * vt[3] + vt[5]}px`;
      el.style.width = `${Math.max(260, br.width * vt[0])}px`;
    };
    reposition();
    canvas.on('after:render', reposition);
    return () => {
      canvas.off('after:render', reposition);
    };
  }, [engine, editingId]);

  // Seed the editor text when entering edit mode.
  useEffect(() => {
    if (area && editorRef.current) {
      editorRef.current.textContent = area.rawPrompt;
      editorRef.current.focus();
    }
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!engine || !editingId || !area) return null;

  const commit = (generate: boolean) => {
    const text = editorRef.current?.textContent ?? '';
    engine.areaManager.commitPrompt(editingId, text, generate);
    exit();
  };

  const exit = () => {
    const obj = engine.canvas
      .getObjects()
      .find((o) => o instanceof FabricPromptArea && o.promptAreaId === editingId) as
      | FabricPromptArea
      | undefined;
    obj?.setEditing(false);
    setEditingId(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exit();
    }
  };

  const recolorWord = async (wordId: string, color: string) => {
    const target = area.words.find((w) => w.id === wordId);
    if (!target) return;
    const oldStyle = { ...target };
    const updatedWords = area.words.map((w) => (w.id === wordId ? { ...w, color } : w));
    usePromptStore.getState().updateArea(editingId, { words: updatedWords });

    const transform = await applyWordStyleDelta(
      { ...area, words: updatedWords },
      { ...target, color },
      oldStyle,
    );
    if (transform.imageDataURL) {
      const obj = engine.canvas
        .getObjects()
        .find((o) => o instanceof FabricPromptArea && o.promptAreaId === editingId) as
        | FabricPromptArea
        | undefined;
      void obj?.setImage(transform.imageDataURL);
      usePromptStore.getState().updateArea(editingId, { generatedImageDataURL: transform.imageDataURL });
    }
  };

  const rotateWord = (wordId: string) => {
    const updatedWords = area.words.map((w) =>
      w.id === wordId ? { ...w, rotation: (w.rotation + 15) % 360 } : w,
    );
    usePromptStore.getState().updateArea(editingId, { words: updatedWords });
  };

  const deleteWord = (wordId: string) => {
    const updatedWords = area.words.filter((w) => w.id !== wordId);
    const prompt = wordsToPrompt(updatedWords);
    usePromptStore.getState().updateArea(editingId, {
      words: updatedWords.length ? updatedWords : tokenizePrompt(prompt),
      rawPrompt: prompt,
    });
    if (editorRef.current) editorRef.current.textContent = prompt;
  };

  return (
    <div
      ref={wrapperRef}
      className="absolute z-20"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="rounded-md border border-[var(--prompt-area-edit)] bg-white/95 p-2 shadow-lg backdrop-blur">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={onKeyDown}
          className="min-h-[48px] w-full rounded-sm px-1 text-sm outline-none"
          data-placeholder="Describe what to generate…"
        />
        {area.words.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
            {area.words.map((w) => (
              <Popover key={w.id}>
                <PopoverTrigger asChild>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-accent"
                    style={{ color: w.color, transform: `rotate(${w.rotation}deg)` }}
                  >
                    {w.text}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44">
                  <div className="flex flex-wrap gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        className="h-5 w-5 rounded-full border"
                        style={{ background: c }}
                        onClick={() => recolorWord(w.id, c)}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => rotateWord(w.id)}>
                      <RotateCw className="h-3.5 w-3.5" /> Rotate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => deleteWord(w.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span>⌘↵ generate · Esc close</span>
          <button className="underline" onClick={() => commit(true)}>
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
