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

// Identity resolution output. Names follow the spec's own example (a relationship from
// ssot__Individual__dlm to IndividualIdentityLink__dlm); confirm them against a real org.
const unified = {
  name: 'UnifiedIndividual__dlm',
  displayName: 'Unified Individual',
  category: 'Profile',
  fields: [
    f('ssot__Id__c', 'Unified Individual Id', 'STRING'),
    f('ssot__FirstName__c', 'First Name', 'STRING'),
    f('ssot__LastName__c', 'Last Name', 'STRING'),
  ],
  indexes: [],
  primaryKeys: [{ name: 'ssot__Id__c', displayName: 'Unified Individual Id', indexOrder: '1' }],
  relationships: [rel('IndividualIdentityLink__dlm', 'UnifiedIndividual__dlm', 'UnifiedRecordId__c', 'ssot__Id__c', 'NTOONE')],
};

const identityLink = {
  name: 'IndividualIdentityLink__dlm',
  displayName: 'Individual Identity Link',
  category: 'Profile',
  // Only the columns the Connect API spec's own examples show on this object.
  fields: [
    f('SourceRecordId__c', 'Source Record Id', 'STRING'),
    f('KQ_SourceRecordId__c', 'Key Qualifier Source Record Id', 'STRING'),
    f('UnifiedRecordId__c', 'Unified Record Id', 'STRING'),
  ],
  indexes: [],
  primaryKeys: [],
  relationships: [
    rel('ssot__Individual__dlm', 'IndividualIdentityLink__dlm', 'ssot__Id__c', 'SourceRecordId__c', 'ONETOONE'),
    rel('IndividualIdentityLink__dlm', 'UnifiedIndividual__dlm', 'UnifiedRecordId__c', 'ssot__Id__c', 'NTOONE'),
  ],
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
  DataModelObject: { metadata: [individual, email, account, engagement, orphan, unified, identityLink] },
  DataLakeObject: { metadata: [lakeContact] },
  CalculatedInsight: { metadata: [ci] },
} as const;

/** Objects visible in the non-default `marketing` data space. */
export const MARKETING_OBJECTS = new Set(['ssot__Individual__dlm', 'ssot__EmailEngagement__dlm', 'Avg_Spends__cio']);

/** `GET /ssot/data-model-object-mappings` in the spec's shape. */
export const MAPPINGS = {
  objectSourceTargetMaps: [
    {
      developerName: 'Contact_Home_Individual_Map',
      status: 'ACTIVE',
      sourceEntityDeveloperName: 'Contact_Home__dll',
      targetEntityDeveloperName: 'ssot__Individual__dlm',
      fieldMappings: [{ developerName: 'm1', sourceFieldDeveloperName: 'Id__c', targetFieldDeveloperName: 'ssot__Id__c' }],
    },
    {
      developerName: 'Contact_Home_Email_Map',
      status: 'ACTIVE',
      sourceEntityDeveloperName: 'Contact_Home__dll',
      targetEntityDeveloperName: 'ssot__ContactPointEmail__dlm',
      fieldMappings: [
        { developerName: 'm2', sourceFieldDeveloperName: 'Id__c', targetFieldDeveloperName: 'ssot__Id__c' },
        { developerName: 'm3', sourceFieldDeveloperName: 'Id__c', targetFieldDeveloperName: 'ssot__PartyId__c' },
        { developerName: 'm4', sourceFieldDeveloperName: 'Email__c', targetFieldDeveloperName: 'ssot__EmailAddress__c' },
      ],
    },
  ],
};

/** `GET /ssot/calculated-insights/{apiName}`, in the shape of the spec's own example. */
export const INSIGHTS: Record<string, unknown> = {
  Avg_Spends__cio: {
    apiName: 'Avg_Spends__cio',
    calculatedInsightStatus: 'ACTIVE',
    creationType: 'Custom',
    dataSpace: 'default',
    definitionStatus: 'IN_USE',
    definitionType: 'CALCULATED_METRIC',
    description: 'Average order value per individual over the last 12 months.',
    displayName: 'Avg Spends',
    expression:
      'SELECT AVG(SalesOrder__dlm.grand_total_amount__c) AS Avg_Spend__c, ssot__Individual__dlm.ssot__Id__c AS Id__c, ' +
      'ssot__Individual__dlm.ssot__FirstName__c AS FirstName__c FROM SalesOrder__dlm JOIN ssot__Individual__dlm ' +
      'ON SalesOrder__dlm.ssot__SoldToCustomerId__c = ssot__Individual__dlm.ssot__Id__c GROUP BY Id__c, FirstName__c',
    isEnabled: true,
    lastCalcInsightStatusDateTime: '2026-10-06T03:05:00.000Z',
    lastCalcInsightStatusErrorCode: null,
    lastRunDateTime: '2026-10-06T03:00:08.000Z',
    lastRunStatus: 'SUCCESS',
    lastRunStatusDateTime: '2026-10-06T03:02:32.000Z',
    lastRunStatusErrorCode: null,
    publishScheduleEndDate: null,
    publishScheduleInterval: 'NOT_SCHEDULED',
    publishScheduleStartDateTime: null,
    dimensions: [
      { apiName: 'Id__c', creationType: 'Custom', dataType: 'Text', dateGranularity: null, displayName: 'Id', fieldRole: 'DIMENSION', formula: 'ssot__Individual__dlm.ssot__Id__c' },
      { apiName: 'FirstName__c', creationType: 'Custom', dataType: 'Text', dateGranularity: null, displayName: 'First Name', fieldRole: 'DIMENSION', formula: 'ssot__Individual__dlm.ssot__FirstName__c' },
    ],
    measures: [
      { apiName: 'Avg_Spend__c', creationType: 'Custom', dataType: 'Number', displayName: 'Avg Spend', fieldAggregationType: 'AGGREGATABLE', fieldRole: 'MEASURE', formula: 'AVG(SalesOrder__dlm.grand_total_amount__c)' },
    ],
  },
};
