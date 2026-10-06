// Fixture metadata in the exact shape of `GET /ssot/metadata` so the mock
// exercises the same normalizer as the real client.

const f = (name: string, displayName: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  displayName,
  type,
  businessType: type === 'DATE_TIME' ? 'DATE_TIME' : type === 'NUMBER' ? 'NUMBER' : 'TEXT',
  ...extra,
});

const rel = (fromEntity: string, toEntity: string, fromEntityAttribute: string, toEntityAttribute: string, cardinality: string) => ({
  fromEntity,
  toEntity,
  fromEntityAttribute,
  toEntityAttribute,
  cardinality,
});

export const DATA_SPACES = {
  dataSpaces: [
    { id: '0vh000000000001AAA', name: 'default', label: 'default', status: 'Active' },
    { id: '0vh000000000002AAA', name: 'marketing', label: 'Marketing', prefix: 'mkt', status: 'Active' },
  ],
  totalSize: 2,
};

const individual = {
  name: 'ssot__Individual__dlm',
  displayName: 'Individual',
  category: 'Profile',
  fields: [
    f('ssot__Id__c', 'Individual Id', 'STRING', { keyQualifier: 'KQ_Id__c' }),
    f('KQ_Id__c', 'Key Qualifier Individual Id', 'STRING'),
    f('ssot__FirstName__c', 'First Name', 'STRING'),
    f('ssot__LastName__c', 'Last Name', 'STRING'),
    f('ssot__BirthDate__c', 'Birth Date', 'DATE_TIME'),
    f('ssot__YearlyIncome__c', 'Yearly Income', 'NUMBER'),
    f('ssot__DataSourceId__c', 'Data Source', 'STRING'),
    f('ssot__CreatedDate__c', 'Created Date', 'DATE_TIME'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Individual Id', indexOrder: '1' }],
  relationships: [
    rel('ssot__ContactPointEmail__dlm', 'ssot__Individual__dlm', 'ssot__PartyId__c', 'ssot__Id__c', 'NTOONE'),
    rel('ssot__Individual__dlm', 'IndividualIdentityLink__dlm', 'ssot__Id__c', 'SourceRecordId__c', 'ONETOONE'),
  ],
};

const email = {
  name: 'ssot__ContactPointEmail__dlm',
  displayName: 'Contact Point Email',
  category: 'Profile',
  fields: [
    f('ssot__Id__c', 'Contact Point Email Id', 'STRING', { keyQualifier: 'KQ_Id__c' }),
    f('KQ_Id__c', 'Key Qualifier Id', 'STRING'),
    f('ssot__PartyId__c', 'Party', 'STRING', { keyQualifier: 'KQ_PartyId__c' }),
    f('KQ_PartyId__c', 'Key Qualifier Party', 'STRING'),
    f('ssot__EmailAddress__c', 'Email Address', 'STRING'),
    f('ssot__CreatedDate__c', 'Created Date', 'DATE_TIME'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Contact Point Email Id', indexOrder: '1' }],
  relationships: [rel('ssot__ContactPointEmail__dlm', 'ssot__Individual__dlm', 'ssot__PartyId__c', 'ssot__Id__c', 'NTOONE')],
};

const account = {
  name: 'ssot__Account__dlm',
  displayName: 'Account',
  category: 'Profile',
  fields: [
    f('ssot__Id__c', 'Account Id', 'STRING', { keyQualifier: 'KQ_Id__c' }),
    f('KQ_Id__c', 'Key Qualifier Account Id', 'STRING'),
    f('ssot__Name__c', 'Account Name', 'STRING'),
    f('ssot__Industry__c', 'Industry', 'STRING'),
    f('ssot__AnnualRevenue__c', 'Annual Revenue', 'NUMBER'),
    f('ssot__CreatedDate__c', 'Created Date', 'DATE_TIME'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Account Id', indexOrder: '1' }],
  relationships: [],
};

const engagement = {
  name: 'ssot__EmailEngagement__dlm',
  displayName: 'Email Engagement',
  category: 'Engagement',
  fields: [
    f('ssot__Id__c', 'Engagement Id', 'STRING'),
    f('ssot__IndividualId__c', 'Individual', 'STRING'),
    f('ssot__EngagementType__c', 'Engagement Type', 'STRING'),
    f('ssot__EngagementDateTime__c', 'Engagement Date', 'DATE_TIME'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Engagement Id', indexOrder: '1' }],
  relationships: [rel('ssot__EmailEngagement__dlm', 'ssot__Individual__dlm', 'ssot__IndividualId__c', 'ssot__Id__c', 'NTOONE')],
};

const orphan = {
  name: 'ssot__Case__dlm',
  displayName: 'Case',
  category: 'Related',
  fields: [f('ssot__Id__c', 'Case Id', 'STRING'), f('ssot__Subject__c', 'Subject', 'STRING')],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Case Id', indexOrder: '1' }],
  relationships: [],
};

const lakeContact = {
  name: 'Contact_Home__dll',
  displayName: 'Contact Home',
  category: 'Profile',
  fields: [
    f('Id__c', 'Id', 'STRING'),
    f('Email__c', 'Email', 'STRING'),
    f('Score__c', 'Score', 'NUMBER'),
    f('ModifiedDate__c', 'Modified Date', 'DATE_TIME'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'Id__c', displayName: 'Id', indexOrder: '1' }],
  relationships: [],
};

const ci = {
  name: 'Avg_Spends__cio',
  displayName: 'Avg Spends',
  dimensions: [f('Id__c', 'Id', 'STRING'), f('FirstName__c', 'First Name', 'STRING')],
  measures: [{ name: 'Avg_Spend__c', displayName: 'Avg Spend', type: 'NUMBER', rollupable: true }],
  relationships: [{ fromEntity: 'ssot__Individual__dlm', toEntity: 'Avg_Spends__cio' }],
  partitionBy: 'Id__c',
};

export const METADATA = {
  DataModelObject: { metadata: [individual, email, account, engagement, orphan] },
  DataLakeObject: { metadata: [lakeContact] },
  CalculatedInsight: { metadata: [ci] },
} as const;

/** Objects visible in the non-default `marketing` data space. */
export const MARKETING_OBJECTS = new Set(['ssot__Individual__dlm', 'ssot__EmailEngagement__dlm', 'Avg_Spends__cio']);
