import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Clip } from '@/lib/project';
import { clipPlayhead, seekClipBeat } from '@/lib/editing';

export function PianoTimeline({
  clip,
  positionBeats,
  zoom,
  division,
  disabled,
  seek,
  variant,
}: {
  clip: Clip;
  positionBeats: number;
  zoom: number;
  division: number;
  disabled: boolean;
  seek: (beat: number) => void;
  variant: 'ruler' | 'playhead';
}) {
  const [dragging, setDragging] = useState(false);
  const length = clip.lengthBeats ?? 4;
  const local = positionBeats - clip.startBeat;
  const inside = clipPlayhead(clip, positionBeats) !== null;
  const seekBeat = (beat: number) => seek(seekClipBeat(clip, beat, division));
  const pointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const surface = event.currentTarget.closest<HTMLElement>('.piano-surface');
    if (surface)
      seekBeat(
        (event.clientX - surface.getBoundingClientRect().left - 55) / zoom,
      );
  };
  if (variant === 'playhead' && !inside && !dragging) return null;
  return (
    <button
      className={variant === 'ruler' ? 'piano-ruler' : 'piano-playhead'}
      aria-label={
        variant === 'ruler'
          ? 'Seek or drag on piano roll ruler'
          : 'Drag piano roll playhead'
      }
      title="Drag to seek the main transport within this MIDI clip"
      disabled={disabled}
      style={
        variant === 'ruler'
          ? { width: length * zoom }
          : { left: 55 + Math.max(0, Math.min(length, local)) * zoom }
      }
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        pointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          pointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          pointer(event);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          seekBeat(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? length
                : Math.max(0, Math.min(length, local)) +
                  (event.key === 'ArrowRight' ? 1 : -1) * (division || 0.1),
          );
        }
      }}
    >
      {variant === 'ruler' ? (
        <>
          {Array.from({ length: Math.ceil(length) + 1 }, (_, index) => (
            <span key={index} style={{ left: index * zoom }} aria-hidden="true">
              {index + 1}
            </span>
          ))}
          {inside && (
            <i
              className="piano-ruler-head"
              style={{ left: local * zoom }}
              aria-hidden="true"
            />
          )}
        </>
      ) : (
        <span aria-hidden="true" />
      )}
    </button>
  );
}
