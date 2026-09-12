import { Inbox, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FieldError,
  InlineEdit,
  Input,
  Kbd,
  Label,
  List,
  ListRow,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressBar,
  SectionHeader,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  Tooltip,
  TypeBadge,
  toast,
  type EntityKind,
} from '@/components/ui';

const KINDS: EntityKind[] = [
  'task',
  'event',
  'note',
  'goal',
  'routine',
  'bill',
  'person',
  'project',
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-transparent">
      <SectionHeader title={title} />
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </Card>
  );
}

/** Dev-only visual review of every component and state. Route: /dev/components */
export function ComponentsGallery() {
  const [title, setTitle] = useState('Submit the report');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight">Components</h1>
        <p className="mt-1 text-ink-muted">
          Every primitive, every state. Tab through with the mouse unplugged.
        </p>
      </div>

      <Block title="Buttons">
        <Button variant="primary">Plan my day</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="gold">Goal</Button>
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button size="lg">Large</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
        <Button size="icon" aria-label="Add">
          <Plus className="size-4" />
        </Button>
      </Block>

      <Block title="Fields">
        <div className="w-64">
          <Label htmlFor="g-input" hint="optional">
            Title
          </Label>
          <Input id="g-input" placeholder="Capture anything…" className="mt-1" />
        </div>
        <div className="w-64">
          <Label htmlFor="g-invalid">Estimate</Label>
          <Input
            id="g-invalid"
            defaultValue="abc"
            invalid
            aria-describedby="g-invalid-err"
            className="mt-1"
          />
          <FieldError id="g-invalid-err">Enter minutes, like 45 or 1h30</FieldError>
        </div>
        <div className="w-64">
          <Label htmlFor="g-select">Energy</Label>
          <Select id="g-select" defaultValue="medium" className="mt-1">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </div>
        <div className="w-full">
          <Label htmlFor="g-textarea">Notes</Label>
          <Textarea id="g-textarea" placeholder="Markdown welcome" className="mt-1" />
        </div>
        <Checkbox
          label="Lock this block"
          description="Locked blocks never move when the day is recalculated."
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
        />
        <div className="w-80">
          <Toggle
            label="Autostart with Windows"
            description="Desktop only"
            checked={on}
            onCheckedChange={setOn}
          />
        </div>
      </Block>

      <Block title="Badges & keys">
        {KINDS.map((k) => (
          <TypeBadge key={k} kind={k} />
        ))}
        <Badge tone="lime">Now</Badge>
        <Badge tone="gold">Important</Badge>
        <Badge tone="danger">Overdue</Badge>
        <Badge tone="ok">Done</Badge>
        <Badge tone="outline">P2</Badge>
        <Kbd spec="mod+k" />
        <Kbd spec="g t" />
        <Kbd>Esc</Kbd>
      </Block>

      <Block title="Overlays">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogTitle>Archive project?</DialogTitle>
            <DialogDescription>
              Its tasks stay searchable. You can restore it from the weekly review.
            </DialogDescription>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Archive</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Popover>
          <PopoverTrigger asChild>
            <Button>Why this task?</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="font-medium">Chosen because</p>
            <ul className="mt-1 list-disc pl-4 text-ink-muted">
              <li>Due in 2 days</li>
              <li>Advances a high-importance goal</li>
              <li>Fits your afternoon energy</li>
            </ul>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Task</DropdownMenuLabel>
            <DropdownMenuItem shortcut="e">Edit</DropdownMenuItem>
            <DropdownMenuItem shortcut="s">Schedule today</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip content="Search everything (Ctrl K)">
          <Button size="icon" aria-label="Search">
            <Search className="size-4" />
          </Button>
        </Tooltip>

        <Button onClick={() => toast.success('Task completed', 'Nice. 25 minutes recorded.')}>
          Toast
        </Button>
        <Button
          onClick={() =>
            toast.warning('Wednesday is overloaded', '6h 40m planned against 5h free.')
          }
        >
          Warning
        </Button>
        <Button
          onClick={() =>
            toast({
              title: 'Moved 3 blocks',
              description: 'Locked blocks stayed put.',
              action: { label: 'Undo', onClick: () => toast('Undone') },
              durationMs: 0,
            })
          }
        >
          With action
        </Button>
      </Block>

      <Block title="Progress & empty">
        <div className="w-56">
          <ProgressBar value={0.5} label="Thesis progress" />
        </div>
        <div className="w-56">
          <ProgressBar value={0.9} tone="gold" size="md" label="Goal attention" />
        </div>
        <div className="w-56">
          <ProgressBar value={1.2} tone="danger" label="Overload" />
        </div>
        <div className="w-full">
          <EmptyState
            icon={<Inbox />}
            title="Inbox zero"
            description="Everything captured has a home. Press c to capture something new."
            action={<Button variant="primary">Capture</Button>}
          />
        </div>
        <div className="flex w-full flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </Block>

      <Block title="List & inline edit">
        <div className="w-full">
          <List aria-label="Example tasks" onActivate={(id) => toast(`Open ${id}`)}>
            <ListRow
              id="t1"
              leading={<Checkbox aria-label="Done" />}
              trailing={<TypeBadge kind="task" />}
            >
              <InlineEdit value={title} onCommit={setTitle} aria-label="Task title" />
            </ListRow>
            <ListRow
              id="t2"
              leading={<Checkbox aria-label="Done" />}
              trailing={<Badge tone="danger">Overdue</Badge>}
            >
              Pay electricity bill
            </ListRow>
            <ListRow id="t3" leading={<Checkbox aria-label="Done" />} trailing={<Kbd>45m</Kbd>}>
              Ask Omar about his interview
            </ListRow>
          </List>
          <p className="mt-2 text-[12px] text-ink-faint">Click a row, then j / k / Enter.</p>
        </div>
      </Block>
    </div>
  );
}
