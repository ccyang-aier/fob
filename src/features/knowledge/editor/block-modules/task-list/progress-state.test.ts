import { expect, spyOn, test } from 'bun:test';
import { Node, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { countCheckedTasks } from './progress-state';

const schema = new Schema({ nodes: {
  doc: { content: 'taskList+' }, taskList: { content: 'taskItem+' },
  taskItem: { content: 'paragraph taskList?', attrs: { checked: { default: false } } },
  paragraph: { content: 'text*' }, text: {},
} });
const item = (checked: boolean, nested?: Node) => schema.node('taskItem', { checked }, [schema.node('paragraph', null, schema.text('Task')), ...(nested ? [nested] : [])]);

test('counts nested tasks without changing immutable document versions', () => {
  const doc = schema.node('doc', null, schema.node('taskList', null, [item(true, schema.node('taskList', null, [item(true), item(false)])), item(false)]));
  expect(countCheckedTasks(doc)).toBe(2);
  const state = EditorState.create({ doc });
  const changed = state.apply(state.tr.setNodeMarkup(1, undefined, { checked: false }));
  expect(countCheckedTasks(changed.doc)).toBe(1);
  expect(countCheckedTasks(state.doc)).toBe(2);
});

test('repeated snapshots over a thousand tasks share one scan, including a zero count', () => {
  const doc = schema.node('doc', null, schema.node('taskList', null, Array.from({ length: 1000 }, () => item(false))));
  const scan = spyOn(Node.prototype, 'descendants');
  try {
    for (let snapshot = 0; snapshot < 1000; snapshot++) expect(countCheckedTasks(doc)).toBe(0);
    expect(scan.mock.calls.length).toBe(1);
  } finally { scan.mockRestore(); }
});
