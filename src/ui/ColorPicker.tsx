import { Popover, PopoverContent, PopoverTrigger } from './primitives/popover';
import { useCanvasStore } from '@/state/canvasStore';

const PRESETS = [
  '#171717', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#2563eb', '#8b5cf6',
  '#ec4899', '#ffffff',
];

export function ColorPicker() {
  const activeColor = useCanvasStore((s) => s.activeColor);
  const setActiveColor = useCanvasStore((s) => s.setActiveColor);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="h-9 w-9 rounded-md border"
          style={{ background: activeColor }}
          title="Color"
        />
      </PopoverTrigger>
      <PopoverContent side="right" className="w-48">
        <input
          type="color"
          value={activeColor}
          onChange={(e) => setActiveColor(e.target.value)}
          className="mb-2 h-9 w-full cursor-pointer rounded"
        />
        <div className="grid grid-cols-5 gap-1.5">
          {PRESETS.map((c) => (
            <button
              key={c}
              className="h-6 w-6 rounded-full border"
              style={{ background: c }}
              onClick={() => setActiveColor(c)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
