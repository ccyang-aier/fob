import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  yes: ['是', 'Yes'],
  no: ['否', 'No'],
  valueRelations: ['{v0} 个关联', '{v0} relations'],
  enterAValidNumber: ['请输入有效数字', 'Enter a valid number'],
  enterYyyyMmDdOrACompleteDate: [
    '请输入 YYYY-MM-DD 或完整日期时间',
    'Enter YYYY-MM-DD or a complete date and time',
  ],
  enterACompleteHttpSUrl: ['请输入完整的 http(s) 链接', 'Enter a complete http(s) URL'],
  chooseAnOptionDefinedForThisColumn: [
    '只能选择列内已声明的选项',
    'Choose an option defined for this column',
  ],
  peopleValuesMustBeMemberIds: ['人员值必须是成员 ID', 'People values must be member IDs'],
  thisColumnTypeCannotBeEditedHere: [
    '该列类型暂不支持在此编辑',
    'This column type cannot be edited here',
  ],
  columnIdsMustBeUnique: ['列 ID 不可重复', 'Column IDs must be unique'],
  columnTypeCannotBeChangedAfterCreation: [
    '列类型创建后不可更改',
    'Column type cannot be changed after creation',
  ],
  selectionColumnsRequireUniqueOptions: [
    '选择列必须声明不重复的选项',
    'Selection columns require unique options',
  ],
  columnNameIsRequired: ['列名不能为空', 'Column name is required'],
});
