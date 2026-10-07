// Salesforce's standard data model objects, from its "Standard DMOs" index (Data 360 DMO mapping
// guide, developer preview), 1,554 objects as of October 2026. One per line: the label without
// " DMO", and, where it isn't the label run together, the name its reference page uses (which is
// closer to the API name: "Legal Entity" is legalenty). Loaded on demand; ~40 KB.
// Regenerate from the index rather than editing by hand.
const RAW = `
Abn Experiment Cohort
Abn Experiment
Abn Experiment Log
Abn Experimentation Cohort Summary
Abn Experimentation Daily Summary
Abn Experimentation Summary
Acad Term Enrl Policy Rule Log
Academic Credential
Academic Interest
Academic Session Attendance
Academic Session
Academic Target
Academic Term
Academic Term Enrollment
Academic Term Regstrn Timeline
Academic Year
Account Contact
Account
Account Location
Account Plan
Account Plan Objective
Account Plan Participant
Account Plan Product
Account Plan Ptcp Stakeholder
Account Plan Related Object Analysis
Account Plan Relationship
Account Plan Stakeholder Action
Account Plan Stakeholder
Account Plan Stakeholder Product
Account Relationship
Account Role
Account Score Adjustment
Account Tier Assignment
Account Tier Definition
Accounting Period
Action Candidate
Action Plan
Action Plan Item
Action Plan Template Assignment
Action Plan Template
Action Plan Template Item
Action Plan Template Version
Actionable List
Actionable List Member
Activity
Activity Participant
Activity Plan
Activity Plan Sales Territory
Activity Timing
Activity Topic
Ad Conversion Tag
Ad
Ad Exchange
Ad Keyword
Ad Site
Ad Strategy
Address
Adverse Event Action
Adverse Event Cause
Adverse Event Contributing Factor
Adverse Event
Adverse Event Identifier
Adverse Event Outcome
Adverse Event Party
Adverse Event Resulting Effect
Adverse Event Support Info
Affiliation
Age Band Hlth Rsk Adj Fctr
Agent Service Presence
Agent Work
Agent Work Skill
Ai Agent Action
Ai Agent Generative Ai Usage
Ai Agent Interaction
Ai Agent Interaction Message
Ai Agent Interaction Step
Ai Agent Message Attachment
Ai Agent Moment
Ai Agent Moment Interaction
Ai Agent Session Attachment
Ai Agent Session
Ai Agent Session Log
Ai Agent Session Participant
Ai Agent Tag Assoc Log
Ai Agent Tag Association
Ai Agent Tag Definition Association
Ai Agent Tag Definition
Ai Agent Tag
Ai Agent Topic
Ai Gateway Req Model Diag
Ai Gateway Req Obj Rec Ctn
Ai Gateway Req Obj Rec
Ai Participant Insight
Ai Retriever Quality Metric
Air Travel Emissions Factor
Air Travel Energy Use
Allergy Intolerance
Alternate Payment
Analytics Generative Metadata
Annual Emissions Inventory
Annual Emssn Inventory Extension
Annual Emssn Rdctn Target
Anti Corruption Initiative Summary
Applicant
Application Decision
Application
Application Item
Application Participant
Application Recommendation
Application Recommender
Application Related Code
Application Review
Application Review Participant
Application Task
Application Task Item
Application Timeline
Appraisal Adjustment
Appraisal
Appraisal Item Add On
Appraisal Item
Appraisal Item Provider Val
Asmt Qstn Materiality Tpc
Assessment Action Item
Assessment Definition
Assessment
Assessment Envelope
Assessment Envelope Item
Assessment Indicator Defined Value
Assessment Indicator Definition
Assessment Indicator Value
Assessment Question Assignment
Assessment Question
Assessment Question Response
Assessment Question Set
Assessment Question Version
Assessment Signature
Assessment Task Content Document
Assessment Task Definition
Assessment Task
Assessment Task Indicator Definition
Assessment Task Order
Asset Action Source
Asset Allocation
Asset Depreciation
Asset
Asset Milestone
Asset Operation
Asset Operation Operator Behavior
Asset Participant
Asset Performance Summary
Asset Sales Action
Asset Service Action
Asset Service Level Objective Consequence
Asset Service Level Objective
Asset State Period
Asset Telematics Event
Asset Telematics Event Fault Cd Mapping
Asset Title
Asset Warranty Term
Assortment Assignment
Assortment
Assortment Product
Attendance Entry
Attendance Policy
Attendance Policy Source Type
Attendance Recording
Attendance Source Data
Attendance Source Type
Attribute Definition
Attribute Value
Auth Location Permit Schedule
Auth Tier Data Use Purpose
Authorization Application Asset
Authorization Application
Authorization Application Place
Authorization Form Consent
Authorization Form Data Use
Authorization Form
Authorization Form Text
Authorization Tier Definition
Bank Transfer Tender
Banker
Benefit Action
Benefit Application
Benefit Assignment Adjustment
Benefit Assignment
Benefit Assignment Group Member
Benefit Disbursement Adjustment
Benefit Disbursement
Benefit Disbursement Hold
Benefit Disbursement Period
Benefit
Benefit Item Code
Benefit Prvd Searchable Fld
Benefit Schedule Assignment
Benefit Schedule
Benefit Session
Benefit Specialty
Benefit Type
Billing Account
Billing Arrangement
Billing Forecast
Billing Policy
Billing Schedule
Billing Schedule Group
Billing Schedule Group Relationship
Billing Treatment
Billing Treatment Item
Biodiversity Summary
Bldg Enrgy Intensity Val
Bldg Size Category
Bnft Asgnt Bnft Item Code
Bnft Auth Tier Def
Bot
Bot Version
Branch Unit
Branch Unit Related Record
Brand
Budget Allocation
Budget Category
Budget Category Value
Budget
Budget Period
Building Energy Intensity
Bulk Email Message
Bulk Message
Bundle Product
Bus Oper Proc Cmpl Plcy Cl Ver
Bus Reg Auth Type Dependency
Business Insight
Business Insight Indicator
Business License Code Set
Business Milestone
Business Operations Process
Business Period
Business Process Definition|customerprocessdefinitiondmo
Business Process Feedback|customerprocessfeedbackdmo
Business Process Group|customerprocgroupdefdmo
Business Profile
Business Regulatory Auth Type
Business Type
Business Unit Chnl Type Rate
Buyer Intent
Buying Committee Campaign
Buying Committee Content
Buying Committee
Buying Committee Member
Buying Committee Product
Buying Committee Role
Buying Comte Mbr Role Asgnt
Calendar Event
Campaign Cohort Attribute
Campaign Cohort Campaign Ranking
Campaign Cohort
Campaign
Campaign Member
Campaign Party Asgnt
Capture Payment
Carbon Emission Scope Allocation
Card Account
Care Barrier Determinant
Care Barrier Type
Care Barrier2
Care Determinant
Care Gap Campaign
Care Gap
Care Limit Type
Care Metric Target
Care Observation
Care Observation Identifier
Care Observation Item
Care Pgm Prov Healthcare Provider
Care Plan Activity Detail
Care Plan Activity
Care Plan Detail
Care Plan
Care Plan Identifier
Care Plan Template Benefit
Care Plan Template
Care Plan Template Goal
Care Preauthorization
Care Preauthorization Item
Care Processing Error
Care Program Assistance
Care Program Campaign
Care Program Detail
Care Program
Care Program Eligibility Rule
Care Program Enrollee
Care Program Enrollee Product
Care Program Enrollee Status Period
Care Program Enrollment Card
Care Program Goal
Care Program Identifier
Care Program Product
Care Program Provider Product
Care Program Site Contract
Care Program Site
Care Program Status Period
Care Program Team Member
Care Program Team Member Role Period
Care Request Diagnosis
Care Request Diagnosis Identifier
Care Request
Care Request Drug
Care Request Exchange Info
Care Request Identifier
Care Request Item
Care Request Reviewer
Care Request Supporting Cntnt
Care Service Visit
Care Service Visit Plan
Care Specialty
Case
Case Episode
Case Milestone
Case Milestone Type
Case Participant
Case Proceeding Complaint
Case Proceeding
Case Proceeding Infraction
Case Proceeding Participant
Case Proceeding Result
Case Program
Case Related Issue
Case Team Member Program
Case Update
Cash Tender
Category Access
Category
Cc Aggr Controller Request
Cc Aggr Detail Product Rcmd Rcmdr
Cc Aggr Include Controller Rqst
Cc Aggr Inventory By Location
Cc Aggr Inventory By Location Grp
Cc Aggr Ocapi Request
Cc Aggr Payment Sales Summary
Cc Aggr Product Co Buy
Cc Aggr Product Rcmd Rcmdr
Cc Aggr Product Recommendation
Cc Aggr Product Sales Summary
Cc Aggr Promotion Activation
Cc Aggr Promotion Co Use
Cc Aggr Promotion Sales Summary
Cc Aggr Registration
Cc Aggr Sales Summary
Cc Aggr Scapi Request
Cc Aggr Search Conversion
Cc Aggr Search
Cc Aggr Search Query
Cc Aggr Source Code Activation
Cc Aggr Source Code Sales
Cc Aggr Visit Checkout
Cc Aggr Visit
Cc Aggr Visit Ip Address
Cc Aggr Visit Referrer
Cc Aggr Visit Robot
Cc Aggr Visit User Agent
Cc Dim Business Channel
Cc Dim Campaign
Cc Dim Coupon
Cc Dim Currency
Cc Dim Customer
Cc Dim Date
Cc Dim Geography
Cc Dim Locale
Cc Dim Location
Cc Dim Location Group
Cc Dim Payment Method
Cc Dim Product
Cc Dim Promotion
Cc Dim Site
Cc Dim Source Code Group
Cc Dim Time
Cc Dim Time Zone
Cc Dim User Agent
Cc Fact Customer List Snapshot
Cc Fact Customer Registration
Cc Fact Inv Rec Snapshot
Cc Fact Inv Rec Snapshot Hourly
Cc Fact Order Line Item
Cc Fact Order Payment
Cc Fact Promotion Activation
Cc Fact Promotion Order Line Item
Cc Fact Realtime Metric
Cc Fact Source Code Activation
Change Request Configuration Item
Change Request
Change Request Related Issue
Change Request Related Item
Channel Engagement
Check Tender
Claim Case
Claim Coverage
Claim Diagnosis
Claim
Claim Item
Claim Item Participant
Claim Participant
Claim Payment Detail
Claim Payment
Claim Supporting Information
Clean Energy Project
Climate Chg Emssn Finc Summary
Climate Chg Risk Opp Summary
Clinical Alert
Clinical Encounter Diagnosis
Clinical Encounter
Clinical Encounter Facility
Clinical Encounter Identifier
Clinical Encounter Provider
Clinical Encounter Reason
Clinical Encounter Service Request
Clinical Measure
Clinical Service Request Detail
Clinical Service Request
Clinical Service Request Identifier
Cmpn Party Asgnt Consideration
Cnfg Item Attribute
Cnfg Item Attribute Value
Cnfg Item Relationship
Cnfg Item Type Definition
Code Set Bundle
Code Set
Collection Plan
Collection Plan Item
Collection Plan Reason
Commodity Usage
Communication Subscription Channel Type
Communication Subscription Consent
Communication Subscription
Communication Subscription Timing
Competency
Competency Related Object
Complaint Case
Complaint
Complaint Participant
Compliance Audit
Compliance Audit Policy Clause
Compliance Audit Regulation Clause
Compliance Audit Risk
Compliance Control
Compliance Control Version
Compliance Evidence Artifact
Compliance Evidence Request Artifact|complianceevidrqstartifactdmo
Compliance Evidence Request
Compliance Plcy Cmpl Cl Ver
Compliance Policy Clause
Compliance Policy Clause Version
Compliance Policy Comms Recipient|compplcycommsrecipientdmo
Compliance Policy Comms Response|compplcycommsresponsedmo
Compliance Policy Communication|compliancepolicycommsdmo
Compliance Policy
Compliance Policy Version
Cond Intrctn Hlth Rsk Adj Fctr
Configuration Item
Consent Action
Consent Status
Constituent Role
Consumed Location Product
Contact Encounter
Contact Encounter Participant
Contact Point Address
Contact Point App
Contact Point Consent
Contact Point Digital Id
Contact Point
Contact Point Email
Contact Point OTT Service
Contact Point Phone
Contact Point Social
Contact Profile
Contact Request
Content Document
Content Document Relationship
Content Document Version
Content Link
Content Source
Content Taxonomy
Content Taxonomy Model
Content Taxonomy Related Term
Content Taxonomy Term
Content Taxonomy Term Rel Object
Content Taxonomy Term Rel Type
Content Taxonomy Term Relationship
Contract
Contract Doc Ver Content Doc
Contract Document Version
Contract Line
Conv Billing Outcome Ptcp Agent
Conv Channel Engagement Summary
Conv Channel Engmt Summary Subject
Conv Chnl Engmt Summary Ptcp
Conv Reason Report Definition
Conv Reason Report Segment Def
Conversation Billing Outcome
Conversation
Conversation Entry
Conversation Entry Transcript Excerpt
Conversation Reason Category
Conversation Reason
Conversion Engagement Summary
Cost Book
Cost Book Entry
Country
Coupon Definition
Coupon
Course Credit Transfer Appln
Course Offering Attendance
Course Offering
Course Offering Participant
Course Offering Participation
Course Offering Ptcp Result
Course Offering Relationship
Course Offering Rgstr Timeline
Course Offering Rubric
Course Offering Schedule
Course Offering Schedule Tmpl
Course Ofr Ptcp Activity Grade
Coverage Benefit
Coverage Benefit Item
Coverage Benefit Item Limit
Coverage Benefit Verification Request
Crbn Credit Alloc
Crbn Credit Alloc Item
Crbn Credit Distribution
Crbn Credit Project
Crbn Emssn Scope Alloc
Crbn Emssn Scope Alloc Val
Credit Memo
Credit Memo Line
Credit Memo Line Tax
Credit Tender
Currency Dated Conversion Rate
Currency Static Conversion Rate
Custody Chain Entry
Custody Item
Custody Item Regulatory Code Violation
Custody Item Relation
Customer Intelligence Journey Stage
Data Use Legal Basis
Data Use Purpose Consent Action
Data Use Purpose
Dcsn Optimization Option Summary
Dcsn Optimization Summary
Dedup Engmt Anlss Text Insight Assoc
Dedup Engmt Anlss Text Insight
Delivery Engagement Summary
Delivery Verification Engmt Summary
Deposit Account
Depreciation Plan
Device Application Engagement
Device Application Template
Device
Device Type Configuration
Diagnostic Summary
Diagnostic Summary Identifier
Digital Content Channel
Digital Content
Digital Content Electronic Media
Digital Content Publish Channel
Digital Content Relationship
Digital Content Space Channel
Digital Content Space
Digital Signature
Digital Wallet
Disclosure
Disclosure Reporting Period
Disease Criteria Condition
Disease Criteria
Disease Definition
Disease Investigation Case
Disease Investigation
Disease Outbreak
Diversity Equity Inclusion Summary
Doc Clause Set Asmt Qstn
Document Checklist Item
Document Clause
Document Clause Set
Document Playbook
Document Playbook Version
Donor Gift Concept
Donor Gift Concept Opportunity
Donor Gift Summary
Driver Performance Summary
Economic Performance Summary
Educ Inst Searchable Profile
Educ Institution Offering
Education Application
Educational Info Request
Electr Lifecycl Emssn Fctr Set
Electricity Emissions Factor Set
Electronic Media
Email Content
Email Engagement
Email Engagement Frequency
Email Engagement Quality Score
Email Engagement Score
Email Message
Email Message Fragment
Email Publication
Email Send Time Optimization
Email Template
Email Template Fragment
Email Template Related Fragment
Email Template Snapshot
Emissions Activity
Emissions Allocation
Emissions Forecast Fact
Employee Demographic Summary
Employee Development Summary
Employee
Employment Benefit Summary
Employment Compensation Summary
Employment
Employment Offer
Employment Offer Vetting Evaluation
Emssn Rdctn Commitment
Emssn Reduction Target
Energy Attr Cert Credit
Energy Attr Cert Purchase
Energy Attr Credit Dstr
Engagement Action
Engagement Analysis Command Execution
Engagement Analysis Grouping Execution
Engagement Analysis Text Assoc
Engagement Analysis Text Association
Engagement Analysis Text Direct Feedback
Engagement Analysis Text
Engagement Analysis Text Insight
Engagement Analysis Text Participant
Engagement Analysis Text Session
Engagement Channel Action
Engagement Channel
Engagement Channel Participant
Engagement Channel Type Consent
Engagement Channel Type
Engagement Channel Usage
Engagement Participant App Role
Engagement Topic
Engmt Insight Knwlg Article Version
Enrollment Eligibility Criteria
Enterprise User Activity
Enterprise User Activity Ptcp
Entp User
Entp User Email
Entp User Identification
Environmental Risk
Error Engagement
Estmt Energy Use Criteria
Estmt Energy Use Job Run
Event Management Participant Type
Event Mgmt Participant Role
Event Mgmt Participant Type Role Map
Event Plan
Examination
Expense Type
Expert
External Assessment Definition
External Learning
External Learning Ptcp Result
Extl Ptcp Rslt Lrnr Pgm Rqmt
Feature Usage
Field History|datamodelobjfieldvalhistdmo
Financial Account Address
Financial Account Balance
Financial Account Custodian Advisor|finclacctcustodianadvisordmo
Financial Account
Financial Account Fee
Financial Account Interest Rate
Financial Account Limit
Financial Account Milestone
Financial Account Party
Financial Account Performance Snapshot|financialaccountprfmsnapshotdmo
Financial Account Transaction
Financial Application
Financial Application Item
Financial Application Item Proposal
Financial Asset Portfolio Target Allocation|finclassetportfoliotargetallocationdmo
Financial Custodian Advisor
Financial Custodian
Financial Customer
Financial Goal
Financial Goal Funding
Financial Goal Party
Financial Holding Closed Position|finclholdingclosedpositiondmo
Financial Holding
Financial Holding Summary
Financial Plan
Financial Security
Fincl Acct Asset Und Mgmt Snpsht
Fiscal Calendar
Fld Svc Obj Chg
Fld Svc Obj Chg Dtl
Fleet Asset
Fleet
Fleet Participant
Flow
Flow Element
Flow Element Run
Flow Run
Flow Version
Flow Version Occurrence
Forecast Item Manager Version Amount
Forecast Item Owner Version Amount
Forecasting Fact
Forecasting Item
Forecasting Item Historical Trend
Forecasting Prediction
Forecasting Quota
Forecasting Type
Formulary
Formulary Item
Freight Hauling Emission Factor
Freight Hauling Energy Use
Fulfillment Order
Fulfillment Order Price Adj
Fulfillment Order Price Adj Tax
Fulfillment Order Product
Fulfillment Order Product Price Adj
Fulfillment Order Product Tax
Fulfillment Order Tax
Fulfillment Plan
Fulfillment Step Dependency
Fulfillment Step
Fulfillment Step Source
Funding Award Amendment
Funding Award Disbursement
Funding Award
Funding Award Requirement
Funding Opportunity
Game Definition
Game Participant
Game Participant Reward
Game Reward
Gen Ai Content Quality Category
Gen Ai Content Quality
Gen Ai Feedback Additional Info
Gen Ai Feedback
Gen Ai Gateway Req Obj Rec Ctn
Gen Ai Gateway Req Obj Rec
Gen Ai Gateway Request Addl Info
Gen Ai Gateway Request
Gen Ai Gateway Request Tag
Gen Ai Gateway Response
Gen Ai Gtwy Req Model Diagnostic
Gen Ai Response App Generation
Gen Ai Response Generation
Generated Action Insight
Generated Operation Plan
Generated Operation Plan Execution
Generated Operation Plan Step
Generated Operation Plan Step Execution
Generated Waste
Geo Demographic Distribution
Gift Actuarial Entry
Gift Agreement
Gift Batch
Gift Cmt Change Attr Log
Gift Commitment
Gift Commitment Schedule
Gift Default Designation
Gift Designation
Gift Entry
Gift Refund
Gift Soft Credit
Gift Stewardship Activity
Gift Stewardship
Gift Transaction Designation
Gift Transaction
Gift Value Forecast
Glb Tenant Consumption Insights
Glb Tenant Entitlement Transaction
Goal Assignment Detail
Goal Assignment
Goal Definition
Goal Definition Product
Goods Product
Gov Financial Assistance Summary
Ground Travel Emission Factor
Ground Travel Energy Use
Harmonized Content Association
Harmonized Content
Hcp Facility Network
Hcp Network Contract
Hcp Treated Condition
Health Cond Definition Relationship
Health Condition Definition
Health Risk Eval Detail
Health Risk Evaluation
Health Score Category
Health Score
Health Score Range Classification
Healthcare Diagnosis
Healthcare Facility
Healthcare Facility Identifier
Healthcare Facility Service
Healthcare Payer Network
Healthcare Performer
Healthcare Practitioner Facility
Healthcare Procedure
Healthcare Provider
Healthcare Provider Facility Specialty
Healthcare Provider Network Tier
Healthcare Provider NPI
Healthcare Provider Searchable Field|healthcareprovidersearchableflddmo
Healthcare Provider Service
Healthcare Provider Specialty
Healthcare Provider Taxonomy
Healthcare Service Detail
Healthcare Service
Healthcare Taxonomy
Hier Cond Hlth Code Mapping
Hier Cond Hlth Rsk Adj Fctr
Hlthcr Practitioner Facility Identifier
Hotel Stay Emission Factor
Hotel Stay Energy Use
Household
Identity Match
Image
Impact Strategy Assignment
Impact Strategy
In Person Engagement
In Person Meeting
In Store Location
Incident Configuration Item
Incident
Incident Related Item
Indicator Assignment
Indicator Definition
Indicator Performance Period
Indicator Result
Individual
Individual Score Adjustment
Inflation Rate
Info Library External Document
Inspection Assessment Indicator
Inspection Type
Insurance Coverage Type
Insurance Policy Asset
Insurance Policy Coverage
Insurance Policy Coverage Participant
Insurance Policy
Insurance Policy Member Asset
Insurance Policy Participant
Insurance Policy Transaction
Interest Tag Definition
Inventory Product Disbursement
Inventory Request
Inventory Request Item
Inventory Serialized Product
Inventory Transfer
Investment Account
Invoice Address Group
Invoice Batch Run
Invoice
Invoice Line
Invoice Line Tax
Involvement Group
Involvement Group Member
Issue Relationship
Job Appln Searchable Field
Job Position Assignment
Job Position
Job Position Pay Grade
Job Position Qualification
Job Position Recruitment Requisition
Job Position Shift
Job Posting Searchable Field
Journey Decisioning Agent Decision
Knowledge Article Category
Knowledge Article
Knowledge Article Engagement
Knowledge Article Feedback
Knowledge Article Version
Knowledge Src File Ref Dmo|knowledgesrcfilerefdmo
Lead
Lead Engagement
Lead Line Item
Lead Preferred Seller
Learner Campus Spaces Activity
Learner Cost Item
Learner Cost Summary
Learner Financial Aid Application
Learner Financial Aid Standing
Learner Learning System Activity
Learner Pathway
Learner Pathway Item
Learner Profile
Learner Program
Learner Program Requirement
Learner Program Rqmt Progress
Learning Achievement
Learning Course
Learning
Learning Equivalency
Learning Eqv Achv Mapping
Learning Foundation Item
Learning Outcome Item
Learning Pathway Template
Learning Pathway Template Item
Learning Pathway Tmpl Pgm Plan
Learning Program
Learning Program Plan
Learning Program Plan Rqmt
Legal Entity Accounting Period|legalentyaccountingperioddmo
Legal Entity|legalentydmo
Life Science Drug Distribution Data
Life Science Drug Prescription Data
Life Science Marketable Product
Linked Knowledge Article
Loan Account
Locale
Location
Location Group Assignment
Location Group
Location Group Prod Excl Chg
Location Group Prod Inv Chg
Location Product Inventory Change
Location Product Inventory
Location Shipping Carrier Method
Loyalty Aggregated Point Expiration Ledger|loyaltyaggregatedptexpirationledgerdmo
Loyalty Benefit
Loyalty Benefit Type
Loyalty Journal Subtype
Loyalty Journal Type
Loyalty Ledger
Loyalty Ledger Traceability
Loyalty Member Currency
Loyalty Member Tier
Loyalty Membership Lifecycle
Loyalty Partner Product
Loyalty Pgm Member Linked Partner
Loyalty Program Badge
Loyalty Program Currency
Loyalty Program Currency Subtype
Loyalty Program Currency Tier
Loyalty Program
Loyalty Program Engagement Attribute
Loyalty Program Engmt Attribute Promotion
Loyalty Program Group Member Relationship
Loyalty Program Member Attribute Value
Loyalty Program Member Badge
Loyalty Program Member Case
Loyalty Program Member
Loyalty Program Member Merge
Loyalty Program Member Promotion
Loyalty Program Partner Currency
Loyalty Program Partner
Loyalty Program Partner Ledger
Loyalty Program Partner Ledger Summary
Loyalty Program Partner Prepaid Pack
Loyalty Program Partner Promotion
Loyalty Tier Benefit
Loyalty Tier
Loyalty Tier Eligibility Src
Loyalty Tier Group
Loyalty Tier Model
Loyalty Tier Mshp Fee Option
Loyalty Tier Promotion
Loyalty Transaction Journal
Mail Letter
Mail Letter Engagement
Managed Care Program Prfm
Managed Event
Managed Event Session
Managed Event Type
Market Audience
Market Journey Activity
Market Segment
Marketing Channel
Marketing Channel Engaged Audience
Marketing Channel Targeted Segment
Marketing Email List
Marketing Grounding File U Dmo|marketinggroundingfileudmo
Marketing Journey Activity
Marketing Journey Activity Run
Marketing Journey
Master Product
Materiality Topic
Materiality Topic Doc Clause Set
Materiality Topic Reference
Meal Card Activity
Measure Definition
Media Buy
Media Buy Package
Media Engagement
Medical Insight Account
Medical Insight
Medical Insight Goal Definition
Medical Insight Product
Medical Insight User Reaction
Medication
Medication Identifier
Member Benefit
Member Plan
Mentoring Profile
Message Engagement
Message Template
Messaging Session
Metadata Search Record
Mgd Event Sess Subject Assignment
Mkt Expert Channel Rate Table
Mng Event Budget|managedeventbudgetdmo
Mng Event Participant|managedeventparticipantdmo
Mng Event Product|managedeventproductdmo
Mng Event Resource|managedeventresourcedmo
Mng Event Resource Preference|managedeventresourcepreferencedmo
Monthly Usage Trkg Data Gap
Network
Network Referenced Object
Network Usage
Notebook Ai Grounding File Udmo|notebookaigroundingfileudmo
Object Milestone
Occupation
Occupation Group
Offer
Offer Group Assigned Offer
Offer Group
Offer Market Segment
Offer Marketing Email List
Offer Product Category
Offer Product
Offer Product Order Engagement
Offer Sales Order Product Engagement
Offer Treatment
Operating Hours
Operating Hours Time Slot
Operator Performance Summary
Opp Sales Methodology Item
Opportunity Contact
Opportunity
Opportunity Historical Trend
Opportunity History
Opportunity Influence
Opportunity Preferred Seller
Opportunity Product
Opportunity Sales Methodology
Opportunity Split
Opportunity Split Type
Opportunity Stage
Order Delivery Method
Org Payment Prac Summary
Organization Incident Summary
Other Emission Factor Set Item
Other Emissions Factor Set
Othr Lifecycl Emssn Fctr Set
Othr Lifecycl Emssn Fctr Set Item
Outcome Activity
Outcome Intent
Outreach Source Code
Outreach Summary
Party Accreditation
Party Award
Party Board Certification
Party Board Certification Identifier
Party Business License
Party Category
Party Consent
Party
Party Expense
Party Financial Asset
Party Financial Liability
Party Identification
Party Income
Party Interest Tag
Party Philanthropic Assessment
Party Philanthropic Indicator
Party Philanthropic Milestone
Party Philanthropic Occurrence
Party Philanthropic Rsrch Prfl
Party Profile Address
Party Profile
Party Promotion Usage
Party Publication
Party Related Party
Party Relationship Type
Party Role
Party Role Type
Patient
Patient Health Condition Detail
Patient Health Condition
Patient Health Reaction
Patient Immunization
Patient Immunization Identifier
Patient Med Recile Stmt Recommendation
Patient Med Recon Recommendation
Patient Medical Procedure Detail
Patient Medical Procedure
Patient Medical Procedure Identifier
Patient Medication Administration
Patient Medication Administration Dtl
Patient Medication Dispense
Patient Medication Dosage
Patient Medication Reconciliation
Patient Medication Request
Patient Medication Statement Detail
Patient Medication Statement
Patient Medication Statement Identifier
Patient Registered Device
Patient Registered Device Identifier
Pay Grade
Pay Grade Step
Pay Grade Step Location
Payment Advice Account Recile
Payment Advice
Payment Advice Line Invoice
Payment Card
Payment Instrument
Payment Method
Payment Proof Account Recile
Payment Proof
Payment Request
Payment Request Line
Payment Term
Payment Term Item
Persnl Rcmd Item Log
Persnl Rcmd Log
Person Academic Credential
Person Affinity
Person Competency
Person Disability
Person Education
Person Employment
Person Examination
Person Language
Person Life Event
Person Location Availability
Person Name
Person Public Profile
Person Public Profile Pref Set
Person Skill
Person Trait
Personalization Decision
Personalization Log
Personalization Point
Personalization Schema
Personalizer
Petition Type
Petitionable Outcome
Plan Benefit
Plan Benefit Item
Planned Gift Annuity Rate
Planned Gift
Planned Gift Performance
Planning Annual Read Measure
Planning Daily Read Measure
Planning Dimension Node
Planning Dimension Node Hierarchy
Planning Dimension Node Relation
Planning Monthly Read Measure
Pltn Impact Risk Opp Summary
Position Benefit
Position
Position Pay Grade
Position Qualification
Prepaid Card
Presentation Click Stream Entry
Presentation
Presentation Forum
Presentation Linked Page
Presentation Page
Presentation Page Product
Presentation Party Access
Price Adjustment Group
Price Book
Price Book Entry
Privacy Consent Log
Problem Configuration Item
Problem
Problem Related Item
Process Exception
Procurement Emission Factor Set
Procurement Emission Factor Set Item
Prod Svc Cmpn Def Ptnr Inv
Prod Svc Cmpn Grp Def Ptnr
Prodt Svc Campaign Grp Def
Prodt Svc Cmpn Cse Prodt
Prodt Svc Cmpn Pref Ptnr
Prodt Svc Cmpn Prodt Btch
Prodt Svc Cmpn Rel Cse
Prodt Svc Cmpn Work Type
Producer
Producer Policy Assignment
Product Attribute
Product Browse Engagement
Product Catalog Category
Product Catalog
Product Category
Product Category Product
Product
Product Emissions Factor
Product Guidance
Product Image
Product Order Engagement
Product Packaging Unit
Product Related Component
Product Related Product
Product Service Campaign
Product Service Campaign Item
Product Svc Campaign Def
Product Translation
Production Batch
Prog Based Hlth Rsk Asmt Fctr
Program Benefit
Program Cohort
Program Cohort Member
Program
Program Enrollment
Program Enrollment Eligibility Criteria
Program Initiative
Program Initiative Enrl
Program Product
Program Term Application Timeline
Promotion Account
Promotion Actionable List
Promotion Channel
Promotion
Promotion Engagement
Promotion Item Engagement
Promotion Limit
Promotion Loyalty Partner Product
Promotion Market Segment
Promotion Offer
Promotion Offer Product
Promotion Offer Product Measure
Promotion Party Transaction
Promotion Product Category
Promotion Product
Promotion Product Measure
Promotion Reward Def Audience
Promotion Reward Definition
Promotion Reward Definition Product
Promotion Stage
Promotion Stage Template
Promotion Template
Prospect
Provider Activity Goal
Provider Activity Goal Measure
Provider Activity Measure Type
Provider Offering
Provider Visit
Provider Visit Dtl Product Message
Provider Visit Marketing Item
Provider Visit Product Detailing
Provider Visit Product Discussion
Provider Visit Requested Sample
Purchaser Plan Association
Purchaser Plan
Quote
Quote Product
Rbt Pgm Rbt Typ Accrual Src Trxn
Rbt Pgm Rbt Typ Payout Src Trxn
Real Estate Property
Rebate Claim
Rebate Member Product Aggregate
Rebate Payment
Rebate Pgm Rbt Type Bnft Mapping
Rebate Prgm Mbr Payout Adjustment
Rebate Program
Rebate Program Member
Rebate Program Member Payout
Rebate Program Payout Period
Rebate Program Rbt Typ Benefit
Rebate Program Rbt Typ Filter
Rebate Program Rbt Typ Payout
Rebate Program Rbt Typ Payout Src
Rebate Program Rbt Type Product
Rebate Program Rebate Type
Received Document
Record Action Selectable Item Extract
Record Aggregation Result
Record Alert
Recruitment Content Section
Recruitment Posting Content Section
Recruitment Posting
Recruitment Requisition
Recruitment Requisition Location
Recruitment Requisition Participant
Recurrence Schedule
Reference Data Load Log
Referral
Refrigerant Emission Factor
Reg Cl Cmpl Control Ver
Reg Cl Cmpl Plcy Cl Ver
Reglt Claim Statement
Regulation Clause
Regulation Clause Version
Regulation
Regulatory Auth Type Product
Regulatory Authority
Regulatory Authorization Type
Regulatory Code Assessment Ind
Regulatory Code
Regulatory Code Relation
Regulatory Code Violation
Regulatory Transaction Fee
Regulatory Transaction Fee Item
Rela Anlss Node
Rela Anlss Node Rela
Rela Anlss Node Rela Evid
Rela Anlss Source
Relationship Analysis
Rental Car Emissions Factor
Rental Car Energy Use
Reported Consumption
Required Document
Required Product
Required Skill
Research Study Candidate
Research Study Candidate Identifier
Research Study Candidate Status Period
Research Study
Research Study Identifier
Research Study Protocol Definition
Research Study Relationship
Resource Work Shift
Retail Store
Retail Store Group Assignment
Retail Store Group
Retail Store Product
Retail Visit KPI
Return Order
Return Order Prod Price Adj
Return Order Product
Return Order Product Tax
Revenue Transaction Error Log
Rglty Code Reg Clause Ver
Rglty Code Viol Reg Cl Ver
Risk Cmpl Ctl Version
Risk
Risk Eval Survey Invt
Risk Evaluation
Risk Impacted Record
Sales Agreement
Sales Agreement Prod Schedule
Sales Agreement Product
Sales Channel
Sales Methodology Def Item
Sales Methodology Definition
Sales Model
Sales Order Change Log
Sales Order Delivery Group
Sales Order
Sales Order Payment Summary
Sales Order Price Adjustment
Sales Order Product
Sales Order Product Engagement
Sales Order Product Price Adjustment
Sales Order Product Price Adjustment Tax
Sales Order Product Tax
Sales Store
Sales Territory Account Prodt Msg Score
Sales Territory Account Rcmd Action
Sales Territory Account Score
Sales Territory Business Plan
Sales Territory
Sales Transaction Fulfillment Request
Saved Application Reference
Scheduling Policy
Scope3Carbon Footprint
Scope3Emissions Source
Scope3Procurement Item
Scope3Procurement Summary
Search Resource
Searchable Reference Document
Service Appointment Assigned Resource
Service Appointment
Service Campaign
Service Campaign Member
Service Campaign Member Item
Service Presence Status
Service Proc Prodt Catg Prodt Extract
Service Process Definition
Service Request
Service Schd Rqst Rsrc Assignment
Service Schd Rqst Rule Violation
Service Schedule Request
Service Schedule Rqst Appointment
Service Territory
Service Territory Resource
Sfdc Api Total Usage Event Log
Sfdc Fld Svc Mobile Ux Actvty Event Log
Sfdc Fld Svc Mobile Ux Error Event Log
Sfdc Fld Svc Mobile Ux Log Event Log
Sfdc Lght Page View Event Log
Sfdc Login Event Log
Sfdc Metadata Catalog
Sfdc Metadata Catalog Enrichment
Sfdc Metadata Catalog Relationship
Sfdc Report Event Log
Sfdc Ui Agent Intrctn Event Log
Shipment
Shipment Product
Shipping Carrier
Shipping Carrier Method
Shopping Cart
Shopping Cart Engagement
Shopping Cart Event Type
Shopping Cart Product Engagement
Shopping Wishlist Engagement
Shopping Wishlist Item Engagement
Skill
SMS Publication
SMS Template
Social Contribution Summary
Social Message
Social Message Engagement
Social Page
Software Application
Software License
Software License Pstn Snpsht
Software License Usage
Software License Use Metric
Specimen
Sprint
Staged Regulation Clause
Staged Regulation
Staged Sftwr License Usage
Staged Software License
State Province
Stationary Asset Carbon Footprint
Stationary Asset Energy Use
Stationary Asset Env Source
Stationary Asset Water Activity
Stnry Asset Annual Fact
Stnry Asset Crbn Ftprnt Itm
Stnry Asset Water Footprint
Stnry Asset Wtr Ftprnt Itm
Store Product Summary
Subject Assignment
Subject Category
Subject
Success Team
Suggested Assessment Definition
Suggested Assessment Reason
Supplier
Supplier Product
Supplier Product Location
Supplier Product Relation
Supplier Risk External Input
Supplier Risk Score
Survey
Survey Invitation
Survey Page
Survey Question Choice
Survey Question
Survey Question Response
Survey Question Score
Survey Question Section
Survey Response
Survey Subject
Survey Version
Sustainability Credit
Sustainability Purchase
Sustainability Scorecard
Sustainability Stakeholder
Sustainability Task
Sustainability Task Group
Sustn Material Use Summary
Svc Schd Request Terr Summary
Task
Tax Account
Tax Disclosure Summary
Tax
Tax Document
Tax Document Item
Tax Filing Assessment
Tax Filing Assessment Document
Tax Filing Assessment Line Item
Tax Filing Assessment Line Itm Doc
Tax Filing
Tax Filing Document
Tax Filing Line Item
Tax Filing Line Item Document
Tax Filing Participant
Tax Filing Payment Instrument
Tax Filing Tax Account
Tax Payment
Tax Policy
Tax Refund
Tax Treatment
Tax Type
Tax Type Period
Team
Team Member
Telematics Provider
Telemetry Log
Telemetry Metrics
Telemetry Trace Span
Tenant Consumption Insights
Territory Model
Time Period
Tracked Communication Detail
Tracked Communication
Trade In Tender
Unit Of Measure
Unitof Measure Conversion
User
User Group
User Group Relationship
User Role
User Sales Territory
Vehicle Asset Carbon Footprint
Vehicle Asset Emissions Source
Vehicle Asset Energy Use
Vehicle Definition
Vehicle
Vehicle Performance Summary
Vehicle Telematics Event
Vehicle Telematics Event Fault Cd Map
Vehicle Trip
Vehicle Trip Driver Behavior
Vetting Evaluation
Video Call
Violation Enforcement Action
Violation Type Assessment Ind
Violation Type
Violation Type Relation
Visit
Visitor
Voice Call
Voice Call Engagement
Volunteer Initiative
Voucher Definition
Voucher
Warranty Term
Waste Footprint
Waste Footprint Item
Watchlisted Learner
Web Event Engagement Summary
Web Page Engagement Summary
Web Search Engagement
Web Store
Web Store Product Catalog
Webpage
Website
Website Engagement
Website Event
Website Item Engagement
Website Publication
Website Source
Website Web Store
Work Order
Work Order Item
Work Resource Absence
Work Resource
Work Resource Skill
Work Type
Work Type Group Role
Worker Compensation Coverage Class
Wst Dispo Emssn Fctr Set
Wst Dispo Emssn Fctr Set Itm
Yearly Usage Trkg Data Gap
`;

export interface StandardDmo {
  label: string;
  /** Lowercase, no separators, no "dmo": what an org's API name normalizes to. */
  key: string;
  /** Salesforce's reference page for it. */
  url: string;
}

export const STANDARD_DMOS: StandardDmo[] = RAW.trim().split('\n').map((line) => {
  const [label, page] = line.split('|') as [string, string | undefined];
  const slug = page ?? `${label.toLowerCase().replace(/[^a-z0-9]/g, '')}dmo`;
  return {
    label,
    key: slug.replace(/dmo$/, ''),
    url: `https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-${slug}-dmo.html`,
  };
});
