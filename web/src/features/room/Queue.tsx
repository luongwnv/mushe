import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QueueItem } from "../../lib/types";
import { formatDuration } from "./format";
import { Icon } from "../../components/Icon";

interface Props {
  items: QueueItem[];
  myVotes: Set<string>;
  myUserId: string;
  isHost: boolean;
  onToggleVote: (itemId: string, voted: boolean) => void;
  onRemove: (itemId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

interface RowProps {
  item: QueueItem;
  index: number;
  voted: boolean;
  canRemove: boolean;
  onToggleVote: () => void;
  onRemove: () => void;
}

function SortableRow({ item, index, voted, canRemove, onToggleVote, onRemove }: RowProps) {
  const [hovered, setHovered] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`qrow2${hovered ? " hovered" : ""}${isDragging ? " dragging" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* drag handle + index */}
      <div className="qcell-idx" {...attributes} {...listeners} style={{ cursor: "grab" }}>
        {hovered || isDragging ? (
          <Icon name="grip" size={14} />
        ) : (
          <span className="qidx-num">{index + 1}</span>
        )}
      </div>

      {/* thumbnail + title + artist */}
      <div className="qcell-title">
        {item.thumbnail_url && (
          <img
            src={item.thumbnail_url}
            alt=""
            width={40}
            height={40}
            style={{ borderRadius: 4, flexShrink: 0, objectFit: "cover" }}
          />
        )}
        <div className="qmeta">
          <div className="qtitle">{item.title}</div>
          <div className="qartist">{item.artist}</div>
        </div>
      </div>

      {/* actions on hover */}
      <div className="qcell-actions">
        {hovered ? (
          <>
            {canRemove && (
              <button className="qaction-btn" onClick={onRemove} title="Remove">
                <Icon name="x" size={15} />
              </button>
            )}
            <button
              className={`qaction-btn${voted ? " voted" : ""}`}
              onClick={onToggleVote}
              title={voted ? "Remove vote" : "Upvote"}
            >
              <Icon name="up" size={15} />
            </button>
          </>
        ) : voted ? (
          <span className="qvote-dot">
            {item.vote_count > 0 && (
              <span style={{ fontSize: 11, color: "var(--accent)" }}>{item.vote_count}</span>
            )}
          </span>
        ) : null}
      </div>

      {/* duration */}
      <div className="qcell-dur">{formatDuration(item.duration_ms)}</div>
    </div>
  );
}

export default function Queue({
  items,
  myVotes,
  myUserId,
  isHost,
  onToggleVote,
  onRemove,
  onReorder,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (items.length === 0) {
    return (
      <p className="muted" style={{ padding: "12px 16px" }}>
        Queue is empty — search above to add a song.
      </p>
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((q) => q.id === active.id);
    const newIndex = items.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder(reordered.map((q) => q.id));
  }

  return (
    <div className="qtable-wrap">
      <div className="qheader">
        <span className="qh-idx">#</span>
        <span className="qh-title">Title</span>
        <span className="qh-votes"></span>
        <span className="qh-dur">
          <Icon name="clock" size={14} />
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="qlist">
            {items.map((q, i) => (
              <SortableRow
                key={q.id}
                item={q}
                index={i}
                voted={myVotes.has(q.id)}
                canRemove={isHost || q.added_by === myUserId}
                onToggleVote={() => onToggleVote(q.id, myVotes.has(q.id))}
                onRemove={() => onRemove(q.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
