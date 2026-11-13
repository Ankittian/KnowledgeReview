import { CardFile } from "./generate-gemini-cards";

export const pmCardFiles: CardFile[] = [
  // ==========================================
  // MODULE: PM (EASY: 20-70 words, 3-4 lines)
  // ==========================================
  {
    scope: "module",
    key: "PM",
    title: "Plant Maintenance",
    context: "Plant Maintenance",
    module: "PM",
    audience: "functional",
    cards: [
      {
        level: "easy",
        topic_key: "module-purpose",
        title: "What Plant Maintenance covers across plant operations",
        body: "Plant Maintenance oversees the reliability, safety, and operational upkeep of company assets.\nIt manages the equipment register, maintenance requests, scheduled overhauls, and work permits.\nThe module ensures machinery operates safely while tracking maintenance costs and downtime.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "preventive-maintenance-lifecycle",
        title: "The core preventive and breakdown maintenance lifecycle",
        body: "Maintenance begins with defining work permit safety templates and equipment master records.\nOperational breakdowns or periodic schedules trigger maintenance requests and formal work orders.\nTechnicians consume engineering spares from warehouse stock and record job execution times.",
        source_refs: ["process:preventive-maintenance"]
      },
      {
        level: "easy",
        topic_key: "equipment-asset-register",
        title: "Centralized equipment register and physical tracking",
        body: "The equipment register maintains comprehensive records for all owned, hired, and leased machinery.\nIt tracks technical specifications, physical operating locations, serial numbers, and custodians.\nHistorical logs capture running hours, breakdown incidents, and component replacement histories.",
        source_refs: ["concept:equipment-category", "summary"]
      },
      {
        level: "easy",
        topic_key: "safety-and-work-permits",
        title: "Work permits enforce hazardous job safety and equipment isolation",
        body: "High-risk maintenance activities mandate approved work permits before execution begins.\nPermits specify electrical lockout, mechanical tagout, and mandatory protective procedures.\nAuthorized clearance ensures personnel safety before technicians begin physical repair work.",
        source_refs: ["concept:work-permit", "process:preventive-maintenance"]
      },
      {
        level: "easy",
        topic_key: "material-management-integration",
        title: "Where Plant Maintenance connects with Material Management",
        body: "Plant Maintenance coordinates with Material Management stores to supply replacement spares.\nApproved maintenance orders generate internal material requisitions for stocked engineering parts.\nStorekeepers issue parts against work orders, charging consumption costs to the equipment.",
        source_refs: ["process:preventive-maintenance", "hand_offs"]
      },
      {
        level: "easy",
        topic_key: "meter-readings-and-utilisation",
        title: "Meter readings and operational utilization tracking",
        body: "Technicians record operating hours, odometer values, and production run times on machinery.\nCumulative utilization triggers usage-based preventive maintenance overhauls automatically.\nAbnormal operating readings alert supervisors to potential equipment failures early.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "service-calls-and-external-repairs",
        title: "Customer equipment service calls and external repair contracts",
        body: "Service teams record field service requests for client-owned or leased installations.\nContract terms define warranty coverage, preventive service visits, and billing rates.\nExternal repair orders track outside contractor interventions on specialized factory machinery.",
        source_refs: ["summary", "description"]
      }
    ]
  },
  {
    scope: "module",
    key: "PM",
    title: "Plant Maintenance",
    context: "Plant Maintenance",
    module: "PM",
    audience: "technical",
    cards: [
      {
        level: "easy",
        topic_key: "technical-architecture-and-schemas",
        title: "Core schemas and entity architecture of Plant Maintenance",
        body: "The Plant Maintenance module operates within the EAM enterprise asset management schema.\nEquipment master entities reside in EAM.EAMEquipmentMaster and linked detail tables.\nMaintenance orders persist within EAM.EAMMaintenanceOrder and EAM.EAMOrderTaskDetail.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "spares-interface-to-inventory-schema",
        title: "Spares reservation interface into the Inventory schema",
        body: "Maintenance order item requirements integrate with the Material Management Inventory schema.\nRequisitions write to Inventory.IIndentRequisition referencing MaintenanceOrderId.\nParts issues from Inventory.IMaterialIssue decrement stores balances and update equipment maintenance costs.",
        source_refs: ["process:preventive-maintenance", "rule:finance-posting-from-transactions"]
      },
      {
        level: "easy",
        topic_key: "eam-stored-procedure-framework",
        title: "Standardized EAM stored procedure naming and execution architecture",
        body: "Plant maintenance backend operations follow standardized stored procedure prefixes.\nMaster maintenance operations execute through EAM.EAEMSave, EAEMLoadData, and EAEMDelete.\nOrder processing procedures invoke EAM.EAMOSave, EAMOLoadData, and EAMODelete.\nExecution errors return structured exception parameters handled by the application framework.",
        source_refs: ["method_notes", "summary"]
      },
      {
        level: "easy",
        topic_key: "meter-reading-trigger-mechanics",
        title: "Meter reading triggers and scheduled occurrence generation",
        body: "Meter entries update cumulative values within EAM.EAMRunningHoursDetail.\nStored procedures evaluate parameter alert thresholds and trigger automatic schedule occurrences.\nSchedule generation algorithms calculate due dates from running hours and calendar frequencies.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "concurrency-and-locking-controls",
        title: "Optimistic concurrency locking and authorization controls in PM",
        body: "PM entities enforce optimistic locking using ModifiedDate and ModifiedBy record stamps.\nConcurrent edits trigger reload warnings to prevent overwriting conflicting updates.\nAuthorized orders lock scheduling dates, resource assignments, and equipment references.",
        source_refs: ["rule:authorized-document-lock", "rule:atomic-save"]
      }
    ]
  },

  // ==========================================
  // FLOW: PM (MEDIUM: 90-200 words, 6-10 lines)
  // ==========================================
  {
    scope: "flow",
    key: "preventive-maintenance",
    title: "Preventive & Breakdown Maintenance (PM)",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM)",
    module: "PM",
    audience: "functional",
    cards: [
      {
        level: "medium",
        topic_key: "four-step-maintenance-flow",
        title: "Four core stages of the preventive and breakdown maintenance flow",
        body: "The maintenance workflow follows four sequential operational stages to preserve plant equipment reliability.\nIt begins by configuring reusable work permit templates defining hazardous job safety rules and isolation steps.\nNext, equipment records are registered with physical locations, operational models, and assigned custodians.\nMaintenance orders are then raised to schedule overhaul tasks, assign technicians, and plan replacement spares.\nThe workflow concludes when stores personnel issue required engineering spares to the maintenance job.\nThis sequence ensures repairs follow documented safety instructions and consume verified warehouse stock.\nTechnicians execute scheduled tasks, record actual downtime, and sign off completed work orders.\nThis structured progression maintains machinery reliability while ensuring complete parts and labor cost accountability.",
        source_refs: ["steps", "summary", "description"]
      },
      {
        level: "medium",
        topic_key: "roles-in-plant-maintenance",
        title: "Roles and operational responsibilities across maintenance workflows",
        body: "Plant maintenance requires close collaboration between engineering, safety officers, and warehouse storekeepers.\nMaintenance planners configure equipment registers, permit safety templates, and recurring overhaul schedules.\nOperating technicians log initial maintenance requests when machinery malfunctions or performance drops occur.\nSafety officers review hazardous conditions, inspect field isolations, and authorize safety clearance permits.\nStorekeepers verify material requisitions and disburse engineering spares to repair crews from stores.\nMaintenance supervisors inspect completed repairs, verify job safety, sign off work orders, and close logs.\nThis multi-departmental collaboration ensures repairs are executed safely, economically, and without unnecessary delay.\nEvery operational milestone creates an auditable record connecting the initial breakdown to final machine sign-off.",
        source_refs: ["steps", "used_by"]
      },
      {
        level: "medium",
        topic_key: "work-permit-prerequisites-and-loto",
        title: "Safety permit prerequisites and lockout tagout isolation",
        body: "Hazardous maintenance jobs require formal safety clearance before physical repair work can begin.\nPermit templates establish mandatory lockout, tagout, and hazardous energy isolation protocols for machinery.\nTechnicians review designated safety instructions and verify physical electrical and mechanical isolation on site.\nSafety supervisors inspect the installation and grant formal written clearance to work before tools engage.\nWork orders linked to mandatory permits cannot proceed until permit sign-offs are logged in the system.\nThese safety gates prevent industrial accidents, electrical shocks, and chemical releases during servicing.\nOnce repairs conclude, de-isolation check lists ensure all personnel and tools are clear before power restoration.\nSafety permit compliance ensures complete statutory adherence to occupational health and safety regulations.",
        source_refs: ["step:1", "concept:work-permit"]
      },
      {
        level: "medium",
        topic_key: "breakdown-versus-preventive-execution",
        title: "Operational handling of unscheduled breakdowns versus scheduled maintenance",
        body: "Maintenance workflows handle both planned upkeep and urgent unscheduled equipment failures across the plant.\nPreventive maintenance generates orders automatically based on elapsed calendar intervals or cumulative running hours.\nUnscheduled breakdowns begin with urgent maintenance requests highlighting equipment stoppage and failure symptoms.\nBreakdown orders prioritize technician assignment, expedite emergency spares requisitioning, and record downtime.\nRecording breakdown duration allows engineering managers to calculate mean time between failures and equipment availability.\nBoth workflows converge at the spares requisition stage to ensure complete parts accountability in stores.\nPreventive interventions reduce emergency stoppages, while breakdown tracking pinpoints chronic mechanical weaknesses.\nThis balanced execution guarantees reliable plant operations while controlling total maintenance expenditures.",
        source_refs: ["step:3", "summary", "description"]
      },
      {
        level: "medium",
        topic_key: "spares-issuance-and-job-closure",
        title: "Stores material issue and equipment cost accumulation",
        body: "The maintenance workflow concludes by consuming replacement engineering spares from company inventory.\nAuthorized maintenance orders generate material requisitions passed directly to warehouse stores for fulfillment.\nStorekeepers disburse required bearings, lubricants, and machine components against the work order reference.\nIssued items immediately reduce inventory balances and charge the consumption expense to the equipment cost center.\nOnce technicians complete repairs, the work order is signed off and equipment resumes active operations.\nThis reconciliation guarantees that machinery maintenance costs reflect actual consumed spares and labor hours.\nClosing the order updates maintenance history records and resets preventive maintenance interval counters.\nAccurate cost accumulation enables plant managers to evaluate total lifecycle costs for major equipment assets.",
        source_refs: ["step:4", "concept:material-issue", "leads_to"]
      }
    ]
  },
  {
    scope: "flow",
    key: "preventive-maintenance",
    title: "Preventive & Breakdown Maintenance (PM)",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM)",
    module: "PM",
    audience: "technical",
    cards: [
      {
        level: "medium",
        topic_key: "document-lineage-and-key-propagation",
        title: "Entity lineage and foreign key propagation across maintenance tables",
        body: "The maintenance workflow links equipment master, work permit, order, and issue tables across database schemas.\nfPermitMaster records establish PermitId keys consumed by fEquipmentMaster and fMaintenanceOrder entities.\nfMaintenanceOrder headers store EquipmentId and reference source MaintenanceRequestId rows through foreign keys.\nDetail tables EAM.EAMOrderItemDetail store ItemId and RequiredQty for spare component planning and reservation.\nMaterial issues in Inventory.IMaterialIssue reference MaintenanceOrderId to close demand lines upon parts disbursement.\nWork order task rows in EAM.EAMOrderTaskDetail maintain foreign keys referencing masterdata.mTaskMaster.\nAudit fields capture OrderDate, CompletionDate, and DownTimeHours to calculate reliability metrics.\nThis relational key propagation ensures complete lineage reporting from permit configuration to spares consumption.",
        source_refs: ["steps", "concept:equipment-category", "concept:material-issue"]
      },
      {
        level: "medium",
        topic_key: "status-cascade-and-demand-clearing",
        title: "Status cascading and material demand closure across PM and inventory",
        body: "Maintenance order authorization triggers status updates across upstream requests and linked inventory tables.\nfMaintenanceRequest rows transition DocumentStatus from Open to In-Progress or Ordered in the database.\nAuthorizing the linked material issue decrements open spare requirements on the maintenance order detail rows.\nWhen all required tasks and material lines are satisfied, the order transitions to Completed status automatically.\nCompleting the order updates downtime logs and recalculates equipment availability metrics within EAM reporting tables.\nCancelling a maintenance order invokes balance restoration routines that release reserved stores inventory.\nStatus recalculations execute within atomic database transactions to ensure consistency between orders and stock.\nThis synchronization prevents orphan material requisitions and unfulfilled maintenance job allocations.",
        source_refs: ["rule:material-receipt-note-source-status-cascade", "rule:atomic-save"]
      },
      {
        level: "medium",
        topic_key: "stored-procedure-architecture-in-eam",
        title: "Backend stored procedure architecture and transaction coordination",
        body: "Maintenance operations execute through specialized stored procedures operating within the EAM schema.\nWork order persistence invokes EAM.EAMOSave which orchestrates header and detail insertions in the database.\nTask line operations execute through EAM.EAMOrderTaskDetailSave within the same transaction scope.\nParts requisition routines interface with Inventory.IIndentRequisitionSave to stage stores demand lines.\nDatabase rollback triggers ensure order headers and requisition links commit synchronously without partial writes.\nLookup routines like EAM.EAMOFillValues populate user dropdowns and equipment filters efficiently.\nDelete handlers invoke EAM.EAMODelete which validates downstream reporting and issue references prior to row removal.\nThis modular stored procedure architecture ensures robust transaction processing and audit tracking.",
        source_refs: ["method_notes", "rule:atomic-save"]
      },
      {
        level: "medium",
        topic_key: "authorization-matrix-and-lock-controls",
        title: "Multi-level authorization workflows and document state locking in PM",
        body: "Maintenance orders transition through Initial, Release, and Authorized lifecycle states during processing.\nAuthorization groups enforce user tier limits configured in masterdata.mAuthorizationGroup and user mapping tables.\nIntermediate sign-offs record audit entries in EAM.EAMOrderApprovalHistory without full authorization.\nOnly designated chief maintenance engineers can transition document status to Authorized in the database.\nAuthorized status triggers database triggers that make task lists and equipment references immutable.\nAmendments require formal revision entries in EAM.EAMOrderAmendment rather than direct updates to authorized orders.\nAudit triggers record prior row states to historical archive tables before status transitions execute.\nThis security architecture protects maintenance schedules and safety check lists from unauthorized alteration.",
        source_refs: ["rule:authorized-document-lock", "rule:material-receipt-note-multi-level-authorization"]
      }
    ]
  },

  // ==========================================
  // FORMS: PM (HARD: 180-380 words, 10-20 lines)
  // ==========================================
  {
    scope: "form",
    key: "fEquipmentMaster",
    title: "Equipment Master",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM) › Equipment Master",
    module: "PM",
    audience: "functional",
    cards: [
      {
        level: "hard",
        topic_key: "place-in-maintenance-workflow",
        title: "Where the Equipment Master sits in the maintenance architecture",
        body: "The Equipment Master is step two in the preventive maintenance setup workflow within Plant Maintenance.\nIt follows Permit Master where safety templates and isolation rules are established for plant operations.\nMaintenance planners use this screen to register every piece of machinery, vehicle, and installed tool.\nIt establishes the definitive asset entity upon which all maintenance orders and service calls are built.\nThe next operational steps are raising maintenance requests and scheduling periodic overhauls.\nEquipment records link to physical factory locations, designated custodians, work centers, and operators.\nBill of materials sections define standard engineering spares required for routine overhauls.\nEvery maintenance request, work order, and breakdown log requires a valid equipment reference.\nAccurate equipment data ensures that machine histories, running hours, and repair costs remain auditable.\nThis screen provides the operational foundation for enterprise asset reliability management across sites.\nPhysical verification against this document ensures company equipment registers match physical floor assets.\nWithout this master definition, engineering teams cannot schedule preventive maintenance or track machine downtime.",
        source_refs: ["summary", "purpose", "process:preventive-maintenance", "used_by"]
      },
      {
        level: "hard",
        topic_key: "mandatory-attributes-and-ownership-types",
        title: "Mandatory equipment attributes, ownership classifications, and validations",
        body: "Creating an equipment record requires critical identification, classification, and ownership inputs.\nThe user must enter an equipment name, serial number, and select a valid ownership category from master options.\nOwnership classifications differentiate clearly between company-owned, hired, and customer equipment.\nSelecting valid equipment categories and equipment types is compulsory for all registered plant assets.\nIf the equipment name or serial number is left blank, saving is immediately prohibited by system checks.\nCustody details require a valid custodian name, contact number, and formal custody assignment date.\nThe year of manufacture date cannot be later than the equipment acquisition date recorded on the header.\nThe date of custody cannot precede the original acquisition date of the machinery under any circumstances.\nDuplicate equipment names or duplicate serial numbers within the company are stopped by validation routines.\nMissing mandatory headers halt saving and highlight the exact asset information requiring user entry.\nThese checks prevent incomplete or duplicate equipment records from contaminating asset registers.\nAccurate classification ensures that maintenance schedules and financial depreciation apply appropriate rules.",
        source_refs: ["validations", "fields", "purpose"]
      },
      {
        level: "hard",
        topic_key: "location-tracking-and-custody-rules",
        title: "Physical location tracking, division alignment, and custodian responsibilities",
        body: "Equipment records track physical operating sites to support maintenance dispatching and inventory delivery.\nThe user specifies operating location, effective location date, work center, and street address details.\nThe operating location must match an active functional location configured in company masters.\nOperating division assignments must align with the operational location of the machinery on site.\nMoving equipment to another factory location requires a formal change of location entry in the system.\nAssigned custodians are responsible for machinery security, operator safety, and daily upkeep.\nIf the custodian contact number contains invalid characters, validation blocks the save operation.\nWhen vehicle equipment includes drivers, driver effective dates and licences are recorded for fleet management.\nAccurate location tracking ensures maintenance technicians are dispatched to the right site during emergencies.\nHistorical location logs preserve a complete audit trail of machine relocations across factory divisions.\nCorrect location mapping guarantees that maintenance costs charge to the proper operational cost center.\nThese controls prevent machinery from operating in unapproved or unmonitored factory areas.",
        source_refs: ["fields", "validations", "concept:functional-location"]
      },
      {
        level: "hard",
        topic_key: "bill-of-materials-and-spares-definition",
        title: "Equipment bill of materials, standard spares, and life span tracking",
        body: "The equipment record maintains a dedicated bill of materials for maintenance spares and assemblies.\nPlanners configure standard replacement parts, sub-assemblies, and consumable items for the asset.\nEach spare line specifies the item reference, technical grade, approved make, unit, and required quantity.\nItems marked for mandatory consumption entry require technicians to record serial numbers on replacement.\nLife span parameters establish the expected operating hours or days before component replacement falls due.\nWhen maintenance orders are generated, bill of materials components default automatically into job plans.\nSpares configured here must exist as active items within Material Management inventory masters.\nPredefined component structures accelerate emergency repair ordering and reduce machine downtime.\nAccurate spares mapping ensures storekeepers stock the exact engineering parts required for overhauls.\nTechnicians review bill of materials specifications before disassembling complex machinery assemblies.\nThis standardization prevents non-standard or incompatible components from being fitted to plant machinery.\nComponent life span tracking enables proactive replacement before in-service mechanical failure occurs.",
        source_refs: ["fields", "functional_description", "purpose"]
      },
      {
        level: "hard",
        topic_key: "safety-permits-and-measurement-parameters",
        title: "Safety permit attachments, measurement parameters, and operating limits",
        body: "High-risk equipment records link directly to mandatory safety permits and check lists in the system.\nPlanners attach approved work permit templates defining electrical lockout and mechanical safety rules.\nMeasurement sections establish operating parameters such as temperature, pressure, and vibration limits.\nEach parameter defines normal operating values, alert thresholds, and daily maximum running limits.\nWhen daily meter readings exceed defined alert thresholds, the system flags maintenance alerts for review.\nSafety instructions attached to the equipment default into all future maintenance work orders.\nTechnicians cannot bypass safety permit requirements during hazardous overhaul operations on site.\nThese safety parameters protect operating personnel and prevent catastrophic equipment failures in the plant.\nHistorical measurement values provide predictive maintenance insights to prevent unexpected breakdowns.\nClear operating limits ensure operators shut down machinery before minor faults cause major damage.\nSafety compliance records remain permanently associated with the asset for regulatory safety audits.\nThis integration guarantees that machinery operates strictly within certified engineering safety envelopes.",
        source_refs: ["fields", "functional_description", "concept:work-permit"]
      },
      {
        level: "hard",
        topic_key: "record-lifecycle-and-deletion-restrictions",
        title: "Equipment lifecycle states, deactivation rules, and deletion restrictions",
        body: "Equipment records remain active throughout the operational life of the machinery in the plant.\nAssets taken out of service can be marked inactive to prevent new maintenance orders from being raised.\nInactive equipment records remain fully available in historical searches for regulatory and audit compliance.\nAn equipment record cannot be deleted if active maintenance orders or requests reference it.\nIf meter readings or running hours have been logged against the asset, deletion is blocked by system checks.\nOpen service contracts or warranty records linked to the equipment also prohibit document deletion.\nAttempting to delete a referenced equipment record triggers an explicit system refusal message detailing dependencies.\nThese restrictions preserve equipment maintenance history and prevent orphan records in asset ledgers.\nUsers must decommission or retire equipment through formal disposal entries instead of deleting records.\nComplete historical maintenance logs remain permanently accessible for engineering review and residual valuation.\nDecommissioned records preserve parts replacement histories that inform future purchasing decisions.\nThis protection ensures that company asset registers remain auditable across entire equipment lifecycles.",
        source_refs: ["actions", "validations", "rule:atomic-save"]
      }
    ]
  },
  {
    scope: "form",
    key: "fEquipmentMaster",
    title: "Equipment Master",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM) › Equipment Master",
    module: "PM",
    audience: "technical",
    cards: [
      {
        level: "hard",
        topic_key: "schema-architecture-and-table-structures",
        title: "Database schema architecture, entity bindings, and keys of fEquipmentMaster",
        body: "fEquipmentMaster is the foundational master maintenance interface operating within the PM module.\nHeader attributes map to EAM.EAMEquipmentMaster with primary key EquipmentId and EquipmentCode.\nTechnical specifications persist in EAM.EAMEquipmentTechDetail and EAM.EAMEquipmentBOM tables.\nSupplemental attributes write to EAM.EAMEquipmentSupplementalInfo linked by EquipmentId.\nMeasurement parameters and alert thresholds map to EAM.EAMEquipmentMeasurementDetail in the schema.\nSafety permit templates link through EAM.EAMEquipmentPermitDetail referencing PermitId.\nOptimistic concurrency relies on ModifiedDate and ModifiedBy columns verified on save execution.\nCustom fields interface through masterdata.customfieldssave during transaction commit.\nUI grid datasets load asynchronously upon individual section selection to optimize client performance.\nForeign key constraints enforce referential integrity against location, cost center, and item master tables.\nAudit triggers record modification history in EAM.EAMEquipmentAuditDetail for compliance tracking.\nAtomic transaction boundaries ensure equipment headers and BOM lines commit synchronously without partial writes.",
        source_refs: ["method_notes", "summary", "concept:equipment-category"]
      },
      {
        level: "hard",
        topic_key: "stored-procedures-and-method-routines",
        title: "Stored procedure bindings for search, load, save, and delete in fEquipmentMaster",
        body: "All backend operations on fEquipmentMaster execute through specialized EAM procedures in the database.\nRecord searches execute through EAM.EAEMSearchData returning paginated equipment headers based on filters.\nSelected equipment details load via EAM.EAEMLoadData and EAM.EAEMFillValues stored procedures.\nBill of materials persistence executes through the dedicated procedure EAM.EAEMSaveBOMDetail.\nCertificate and warranty details save through the stored procedure EAM.EAEMSaveCertificateDetail.\nLot and serial reference details persist via EAM.EAEMSaveLotDetail within the save transaction.\nPrimary entity persistence is orchestrated by the master save routine EAM.EAEMSave.\nRecord deletion invokes EAM.EAEMDelete which evaluates downstream maintenance and work order references.\nDependent dropdown lookups populate dynamically using EAM.EAEMFillValuesDependent routines.\nStored procedures return structured error codes handled by the application exception layer.\nAll persistence procedures execute within serialized transaction blocks to maintain data consistency.\nAudit logging procedures capture user credentials and execution timestamps across all master modifications.",
        source_refs: ["method_notes", "validations"]
      },
      {
        level: "hard",
        topic_key: "validation-triggers-and-rejection-conditions",
        title: "Validation logic, Boolean conditions, and error triggers in fEquipmentMaster",
        body: "fEquipmentMaster enforces strict integrity rules prior to executing persistence routines in the database.\nEmpty EquipmentName or SerialNo raises an immediate validation error stopping execution on save.\nYearOfManufactureDate > AcquisitionDate triggers date validation refusal.\nDateOfCustody < AcquisitionDate triggers chronology validation failure.\nMissing EquipmentCategory or EquipmentType dropdown selections aborts transaction processing.\nDivisionId mismatch between equipment and assigned LocationId triggers division validation errors.\nDuplicate EquipmentName within the same company fires duplicate name exceptions.\nNegative or zero alert thresholds on measurement parameters trigger numeric validation errors.\nValidation routines execute within client pre-checks and server validation procedures.\nInactive item codes selected within the bill of materials trigger item master validation errors.\nAll exceptions return structured error parameters mapped to localized user error notifications.",
        source_refs: ["validations", "fields"]
      },
      {
        level: "hard",
        topic_key: "child-record-mutation-and-bom-persistence",
        title: "Child record mutation logic, BOM persistence, and atomic transactions",
        body: "Child record updates utilize a delete-and-reinsert pattern across secondary tables in the database.\nExisting rows in EAM.EAMEquipmentBOM and measurement tables are purged on save execution.\nCurrent UI grid rows are inserted anew within a single atomic database transaction.\nIf any child insertion fails, the entire transaction rolls back preserving original data.\nHistorical change logs capture prior equipment attributes before row replacement executes.\nConcurrency timestamps prevent child replacement if another session modified the record.\nForeign key cascades verify that item codes in the BOM exist in masterdata.mItemMaster.\nAudit triggers record changes in equipment physical locations to historical relocation tables.\nAtomic transaction scopes guarantee that equipment attributes and BOM lines stay synchronized.\nLine replacement commits synchronously with document header updates within a single transaction.\nThis mutation pattern prevents partial configuration saves and eliminates orphaned child records.",
        source_refs: ["rule:detail-replacement-on-save", "rule:atomic-save", "method_notes"]
      },
      {
        level: "hard",
        topic_key: "referential-integrity-and-deletion-guards",
        title: "Referential integrity constraints and backend deletion barriers in PM",
        body: "Backend deletion procedures evaluate foreign key dependencies across maintenance schemas in the database.\nEAM.EAEMDelete queries EAM.EAMMaintenanceOrder to detect linked work orders.\nThe presence of linked MaintenanceRequest or MaintenanceOrder records blocks deletion.\nQueries against EAM.EAMRunningHoursDetail prevent deletion if meter logs exist for the asset.\nActive service contracts in EAM.EAMServiceContractDetail create blocking integrity constraints.\nPermit links in EAM.EAMEquipmentPermitDetail prevent deletion while permit bindings exist.\nDeletion handlers execute within explicit transaction blocks with rollback on violation.\nAudit tables log deletion attempts, user credentials, and machine IP addresses.\nSoft-deactivation flags Inactive are updated when assets are decommissioned from service.\nHard deletes are permitted only on unreferenced draft equipment records by administrators.\nReferential integrity barriers protect historical asset maintenance logs from accidental removal.\nDatabase triggers ensure child records in specification tables purge synchronously on draft removal.",
        source_refs: ["method_notes", "validations", "rule:atomic-save"]
      }
    ]
  },
  {
    scope: "form",
    key: "fMaintenanceOrder",
    title: "Maintenance Order",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM) › Maintenance Order",
    module: "PM",
    audience: "functional",
    cards: [
      {
        level: "hard",
        topic_key: "place-in-maintenance-workflow",
        title: "Where the Maintenance Order sits in the operational maintenance workflow",
        body: "The Maintenance Order is step three in the preventive maintenance operational sequence.\nIt immediately follows the Maintenance Request where equipment faults are initially reported by operators.\nMaintenance planners use this screen to translate a maintenance need into a detailed job plan.\nIt schedules required tasks, assigns responsible technicians, and plans replacement engineering spares.\nThe next operational step is issuing required replacement spares from warehouse stores to repair crews.\nThe order consolidates task instructions, safety permit check lists, and specialized tool requirements.\nIt serves as the binding authorization for technicians to perform physical repair work on plant machinery.\nWhen work is completed, technicians report actual hours and equipment downtime against this order.\nAccurate order planning ensures maintenance is executed safely, on time, and within approved budgets.\nAuthorizing the order releases material requisitions into warehouse management systems for stores fulfillment.\nWithout an authorized work order, storekeepers cannot issue spare parts for equipment overhauls.\nThis document provides complete traceability from initial fault detection to final operational sign-off.",
        source_refs: ["summary", "purpose", "process:preventive-maintenance", "used_by"]
      },
      {
        level: "hard",
        topic_key: "mandatory-headers-and-asset-validations",
        title: "Mandatory order headers, equipment selections, and location checks",
        body: "Creating a maintenance order requires critical operational headers and asset selections in the system.\nThe user must select a valid reference object, target equipment, and maintenance category.\nThe operating division selected on the order must match the current physical location of the asset.\nIf the equipment location differs from the order division, the system immediately halts saving.\nA valid maintenance type, source document, and responsible person must be recorded on the header.\nThe document date cannot precede the scheduled occurrence date of the maintenance job.\nEstimated start dates cannot be earlier than the current document creation date.\nEstimated end dates cannot precede the estimated start date under any operational circumstances.\nEstimated job duration must be entered as a positive number of operating hours.\nMissing mandatory headers halt saving and highlight the exact field requiring user attention on screen.\nDivision alignment rules ensure that repair expenditures are allocated to the correct operating facility.\nAccurate header information establishes clear operational ownership and scheduling accountability.",
        source_refs: ["validations", "fields", "rule:mandatory-document-fields"]
      },
      {
        level: "hard",
        topic_key: "task-scheduling-and-resource-alignment",
        title: "Task scheduling constraints, fault assignments, and technician allocations",
        body: "Every maintenance order must contain at least one valid maintenance task detail line in the schedule.\nAssigned tasks must link to specific fault descriptions identified on the source maintenance request.\nTask start dates cannot precede the overall estimated start date of the maintenance order.\nTask completion dates cannot exceed the overall estimated end date of the maintenance order.\nResource allocations and technician assignments must align with scheduled task dates.\nTechnician service quantities cannot be left blank, zero, or negative on any allocation line.\nService items must possess valid billing rates and active maintenance skill classifications.\nIf breakdown status was flagged on the request, omitting breakdown flags triggers confirmation warnings.\nThese scheduling constraints ensure that tasks and resources fit realistically within the overhaul window.\nAccurate task breakdown allows supervisors to monitor progress and track labor efficiency across jobs.\nPredefined task sequences ensure that complex machinery overhauls follow standardized engineering protocols.\nProper resource alignment prevents scheduling conflicts among specialized maintenance technicians.",
        source_refs: ["validations", "fields", "purpose"]
      },
      {
        level: "hard",
        topic_key: "spares-planning-and-material-demands",
        title: "Spares planning, warehouse requisitions, and material allocations",
        body: "Planned replacement components must be specified on the item requirements section of the order.\nEach spare line specifies the item reference, required quantity, unit, and designated warehouse.\nRequired spare quantities cannot be left blank, zero, or negative on any item line.\nSpares selected must exist as active engineering inventory in Material Management masters.\nAuthorizing the maintenance order generates formal material requisitions for warehouse stores.\nStorekeepers verify available stock and stage components prior to maintenance execution on site.\nIf required spares are out of stock, procurement indents are triggered automatically by the system.\nComponent consumption is charged directly to the equipment once items are issued by stores.\nAccurate spares planning prevents job delays and minimizes unscheduled equipment downtime in the plant.\nTechnicians cannot withdraw unapproved spares without formal work order amendments.\nThis inventory integration guarantees complete material traceability and accurate machine maintenance costing.\nUnused spare components must be formally returned to stores to credit the maintenance job.",
        source_refs: ["validations", "fields", "process:preventive-maintenance"]
      },
      {
        level: "hard",
        topic_key: "safety-permit-clearance-and-loto-rules",
        title: "Work permit clearance, lockout tagout compliance, and safety sign-offs",
        body: "When maintenance involves hazardous machinery, safety permit compliance is strictly mandatory.\nPermit sections import required safety instructions and lockout tagout check lists from permit masters.\nTechnicians and safety officers must physically verify electrical and mechanical isolation on site.\nIf mandatory safety permits are unapproved, the system blocks starting the work order.\nSafety check points must be signed off individually before machinery can be disassembled by technicians.\nAfter work is finished, de-isolation procedures verify that tools and personnel are clear.\nWork permits linked to the order must be formally surrendered upon job completion.\nThese safety controls prevent electrical shocks, toxic exposures, and machinery entrapment during overhauls.\nSafety records remain permanently linked to the order for statutory occupational audits and compliance reviews.\nOperating permits ensure that hazardous energy sources remain locked out until all technicians sign off.\nThis safety protocol protects human life and enforces strict industrial safety discipline.",
        source_refs: ["fields", "functional_description", "concept:work-permit"]
      },
      {
        level: "hard",
        topic_key: "authorization-locking-and-job-completion",
        title: "Authorization controls, record locking, and job completion sign-off",
        body: "Maintenance orders advance through three formal operational statuses: Initial, Release, and Authorized.\nSaving in Release status records the planner identity and queues the order for authorization review.\nUnder multi-tier authorization, only the final designated engineer can transition status to Authorized.\nAttempting unauthorized status changes produces error notifications stopping the save operation in the system.\nOnce authorized, the maintenance order is completely locked against direct field modifications.\nIf work requirements change, an authorized maintenance order amendment must be created through formal channels.\nWhen physical repairs conclude, technicians log actual hours, downtime, and return remaining spares.\nClosing the order marks the job completed and releases the machinery back to operations.\nLocked order records preserve an accurate history of maintenance interventions and repair costs.\nCompleted orders update equipment reliability metrics including mean time between failures.\nThis state progression guarantees strict managerial oversight over plant repair activities and maintenance budgets.",
        source_refs: ["validations", "rule:authorized-document-lock", "rule:atomic-save"]
      }
    ]
  },
  {
    scope: "form",
    key: "fMaintenanceOrder",
    title: "Maintenance Order",
    context: "Plant Maintenance › Preventive & Breakdown Maintenance (PM) › Maintenance Order",
    module: "PM",
    audience: "technical",
    cards: [
      {
        level: "hard",
        topic_key: "form-architecture-and-data-models",
        title: "Database schema architecture, entity bindings, and data models of fMaintenanceOrder",
        body: "fMaintenanceOrder is the primary work order management interface operating within the PM module.\nHeader attributes map to EAM.EAMMaintenanceOrder with primary key OrderId and DocNo.\nTask details persist in EAM.EAMOrderTaskDetail capturing TaskId, AssignedTo, and ScheduledDates.\nMaterial demands map to EAM.EAMOrderItemDetail storing ItemId, WarehouseId, and RequiredQty.\nResource allocations persist in EAM.EAMOrderResourceDetail and skill mapping tables.\nSafety permit linkages map to EAM.EAMOrderPermitDetail and check list audit tables.\nEntity state transitions follow DocumentStatus flags Initial, Release, and Authorized.\nOptimistic concurrency relies on ModifiedDate and ModifiedBy columns verified on save execution.\nShared custom fields interface through masterdata.customfieldssave during transaction commit.\nForeign key constraints enforce referential integrity against equipment, employee, and task masters.\nAudit triggers record modification history in EAM.EAMOrderAuditDetail for compliance tracking.\nAtomic transaction boundaries ensure order headers, tasks, and item demands commit synchronously.",
        source_refs: ["method_notes", "summary", "concept:equipment-category"]
      },
      {
        level: "hard",
        topic_key: "stored-procedures-and-method-routines",
        title: "Stored procedure bindings for search, load, save, and delete in fMaintenanceOrder",
        body: "All backend operations on fMaintenanceOrder execute through specialized EAM procedures in the database.\nRecord searches execute through EAM.EAMOrderSearchData returning paginated order headers based on criteria.\nSelected order details load via EAM.EAMOrderLoadData and EAM.EAMOFillValues stored procedures.\nTask, resource, and item details load through EAM.EAMOFillValuesDependent routines.\nTransaction persistence is orchestrated by the master save routine EAM.EAMOSave.\nTask detail persistence executes through EAM.EAMOrderTaskDetailSave within the transaction.\nRecord deletion invokes EAM.EAMODelete which validates downstream reporting and issue references.\nLookup values and responsible person lists populate using EAM.EAMOFillValues procedures.\nCustom validation routines execute through EAM.EAMOrderCustomValidation handlers.\nStored procedures return structured error codes handled by the application exception layer.\nAll persistence procedures execute within serialized transaction blocks to maintain data consistency.\nAudit logging procedures capture user credentials and execution timestamps across all order modifications.",
        source_refs: ["method_notes", "validations"]
      },
      {
        level: "hard",
        topic_key: "validation-triggers-and-rejection-conditions",
        title: "Validation logic, Boolean conditions, and error triggers in fMaintenanceOrder",
        body: "fMaintenanceOrder enforces strict scheduling and integrity rules prior to saving in the database.\nOrderDivision != EquipmentLocation triggers validation errors halting transaction execution on save.\nEstimatedStartDate < DocumentDate fires an immediate date validation refusal.\nEstimatedEndDate < EstimatedStartDate aborts processing with duration sequence exceptions.\nEstimatedDuration <= 0 triggers numeric validation failure for planned labor hours.\nTaskStartDate < OrderEstimatedStartDate or TaskEndDate > OrderEstimatedEndDate fires range errors.\nEmpty TaskName or empty RequiredQty on item rows halts saving with mandatory line errors.\nDocumentStatus == Authorized halts save attempts with Authorized MaintenanceOrder can't be updated.\nMulti-level authorization bypass attempts abort processing with authorization level errors.\nValidation checks execute sequentially within client pre-checks and server validation procedures.\nMissing equipment selections or inactive task masters trigger foreign key validation exceptions.\nStructured error messages identify the exact line item and column violating business constraints.",
        source_refs: ["validations", "rule:authorized-document-lock"]
      },
      {
        level: "hard",
        topic_key: "detail-replacement-and-atomic-save",
        title: "Detail line replacement architecture and atomic transaction boundaries",
        body: "Editing existing fMaintenanceOrder documents utilizes a detail replacement mutation pattern in the database.\nExisting child rows in EAM.EAMOrderTaskDetail and EAM.EAMOrderItemDetail are purged on save.\nCurrent UI grid rows are inserted anew within a single atomic database transaction.\nIf any task or item insertion fails, the entire transaction rolls back preserving original data.\nCascade routines update source MaintenanceRequest statuses from Open to In-Progress.\nMaterial requisitions in Inventory schema update open reservation balances against the order.\nHistorical change logs capture prior order attributes before detail row replacement executes.\nConcurrency timestamps prevent detail replacement if another session modified the record.\nAtomic transaction scopes guarantee that work orders and inventory demand stay synchronized.\nLine replacement commits synchronously with document header updates within a single transaction.\nThis mutation pattern prevents partial configuration saves and eliminates orphaned task records.",
        source_refs: ["rule:detail-replacement-on-save", "rule:atomic-save", "method_notes"]
      },
      {
        level: "hard",
        topic_key: "concurrency-controls-and-referential-guards",
        title: "Concurrency controls, optimistic locking, and referential barriers in PM",
        body: "fMaintenanceOrder enforces optimistic concurrency to maintain consistency in multi-user environments.\nWhen saving, the procedure compares the client ModifiedDate with the database record timestamp.\nIf another session modified the order, the server returns Someone updated this record.\nReferential integrity barriers prevent document deletion once downstream processes engage.\nIf actual work reporting records exist in EAM.EAMMaintenanceReporting, deletion is blocked.\nIf storekeepers have issued materials in Inventory.IMaterialIssue, deletion is disallowed.\nAuthorized orders cannot be deleted or un-authorized through standard application interfaces.\nOrder cancellation routines must be utilized to terminate unwanted jobs formally in the system.\nSecurity audit tables log all authorization, update, and deletion attempts with user session data.\nDatabase triggers enforce referential barriers across EAM, Inventory, and masterdata schemas.\nOptimistic locking prevents lost updates during simultaneous job scheduling by maintenance planners.\nAudit trails preserve complete historical snapshots of maintenance orders for statutory compliance.",
        source_refs: ["method_notes", "validations", "rule:authorized-document-lock"]
      }
    ]
  }
];
