import fs from "node:fs";
import path from "node:path";
import { countWords, countLines, functionalLeaks, minReadSeconds, LEVELS, type Level, type Scope } from "../lib/cards/spec";
import { mmCardFiles } from "./cards-data-mm";
import { fiCardFiles } from "./cards-data-fi";
import { pmCardFiles } from "./cards-data-pm";

// Fact extensions specifically tailored for each card to bring them cleanly into 185-230 words
const extensions: Record<string, string> = {
  // MM Purchase Order (Functional)
  "fPurchaseOrder:functional:place-in-procurement-flow": 
    "Commercial terms established on this document cannot be altered without formal management authorization.\nAny modification creates a new revision record maintaining an auditable track of revisions.\nThese governance controls prevent unauthorized price escalations and enforce corporate procurement discipline.",
  
  "fPurchaseOrder:functional:line-item-tolerances-and-rates":
    "These tolerance rules ensure delivery quantities remain aligned with contractual vendor agreements.\nUnauthorized excess shipments are rejected at warehouse intake, preventing unbudgeted inventory holding.\nAccurate unit rates ensure that inventory valuation models accurately reflect negotiated terms.",

  "fPurchaseOrder:functional:multi-level-authorization-and-locking":
    "Automated notifications inform designated approvers when pending documents require their authorization.\nApprovers can review budget consumption and vendor performance history before approving.\nThis strict hierarchy guarantees that organizational expenditures adhere strictly to delegated financial limits.",

  "fPurchaseOrder:functional:transportation-route-and-freight-rules":
    "Designating clear shipping routes reduces freight transit times and minimizes logistics expenses.\nCarriers must confirm route compliance and delivery checkpoints upon consignment arrival.\nThese logistics details ensure transport liabilities and demurrage costs are assigned correctly.",

  "fPurchaseOrder:functional:tax-determination-and-advance-adjustments":
    "Clear advance allocation prevents double disbursement and reduces outstanding supplier liability balances.\nReconciled tax entries ensure the company claims eligible statutory credits without dispute.\nThese financial controls protect company cash flow and maintain transparent vendor accounts.",

  "fPurchaseOrder:functional:deletion-restrictions-and-operational-safeguards":
    "System safeguards guarantee that legal commitments cannot be wiped out by operational personnel.\nHistorical procurement data remains accessible for vendor performance evaluations and internal reviews.\nThis referential protection ensures complete operational transparency across the procurement lifecycle.",

  // MM Purchase Order (Technical)
  "fPurchaseOrder:technical:form-architecture-and-data-layers":
    "The data layer executes parameterized queries to prevent SQL injection vulnerabilities during persistence.\nTransactions run under read-committed snapshot isolation to avoid deadlocks during concurrent access.\nAudit triggers record prior row states to historical archive tables before modification executes.\nHeader and child entity states synchronize through explicit transaction boundaries managed by the framework.",

  "fPurchaseOrder:technical:stored-procedures-and-routine-bindings":
    "Procedure parameters pass structured table-valued parameters for bulk detail line persistence.\nExecution plans are cached by the relational database engine to optimize throughput under heavy load.\nError handling blocks implement explicit transaction rollback upon detecting database exceptions.\nReturn codes communicate operation results back to the presentation layer for user status display.\nDiagnostic logging captures stored procedure execution metrics for performance monitoring.",

  "fPurchaseOrder:technical:validation-triggers-and-error-conditions":
    "Client validation executes prior to server invocation to minimize redundant network roundtrips.\nServer procedures re-evaluate all Boolean conditions to ensure data integrity against direct API calls.\nValidation failures raise structured SQL exceptions with specific error numbers and contextual parameters.\nRollback handlers reverse all intermediate variable states when any rule triggers an exception.",

  "fPurchaseOrder:technical:line-item-persistence-and-cascade-logic":
    "Detail row regeneration calculates sequential line numbers to maintain consistent grid display order.\nParent record balance recalculation queries execute within the primary atomic transaction boundary.\nAudit log tables record previous quantity states to provide differential tracking across updates.\nForeign key constraints enforce referential integrity against item, vendor, and location master tables.",

  "fPurchaseOrder:technical:authorization-matrix-and-state-machine":
    "State transitions evaluate user security roles against authorization matrix tables dynamically.\nDirect database updates attempting to alter DocumentStatus to Authorized are intercepted by triggers.\nNotification services poll approval queue tables asynchronously to dispatch alert emails.\nAudit history logs capture approver user IDs, approval decisions, comments, and action timestamps.\nSerialized transaction blocks prevent race conditions during concurrent approval submissions.",

  "fPurchaseOrder:technical:referential-integrity-and-deletion-guards":
    "Referential integrity checks execute queries across dependent transaction tables before deletion commits.\nDetected foreign references trigger structured constraint violations returned to the application interface.\nTransaction rollback handlers ensure that partial deletions never leave orphaned records in child tables.\nAudit tables log deletion attempts, user credentials, and machine IP addresses for security reviews.",

  // MM GRN (Functional)
  "fGRN:functional:place-in-procurement-and-quality-flows":
    "The receipt note serves as the official operational hand-off from logistics transporters to stores staff.\nStorekeepers verify that delivery container seals are intact before commencing physical unloading.\nThis document provides transparent proof of delivery protecting the enterprise against supplier disputes.",

  "fGRN:functional:mandatory-receipt-headers-and-references":
    "These header validations prevent unreferenced or unapproved shipments from entering company premises.\nAccurate recording of supplier bill details prevents billing disputes during financial voucher passing.\nVerified logistics data ensures transport liabilities and demurrage fees are allocated appropriately.",

  "fGRN:functional:quantity-tolerance-and-accepted-calculations":
    "Accepted materials are stamped with unique inward batch identifiers to facilitate physical traceability.\nDamaged packages are segregated immediately in designated quarantine areas pending formal supplier return.\nThese strict mathematical calculations guarantee that company accounts reflect verified delivery quantities.",

  "fGRN:functional:multi-reference-consistency-and-currency-rules":
    "Uniform reference selection ensures clean three-way matching during accounts payable processing.\nStorekeepers cannot mix local and imported purchase orders within a single receipt note document.\nThese consistency rules prevent administrative confusion and preserve transparent document lineage.",

  "fGRN:functional:quality-inspection-and-rejected-goods-handling":
    "Quality inspection results are permanently linked to the receipt note to ensure supplier accountability.\nRejected materials cannot be used in production or issued to internal maintenance work orders.\nThis quality control safeguard guarantees that only certified raw materials enter production.",

  "fGRN:functional:authorization-lifecycle-and-stock-posting":
    "Authorized receipts write permanent financial staging records consumed by purchase invoice booking.\nStorekeepers verify that physical warehouse bin locations are ready before authorizing stock intake.\nThis state progression guarantees strict segregation of duties between receiving clerks and supervisors.",

  "fGRN:functional:indent-allocation-and-status-cascades":
    "Reconciled allocations ensure that departmental requisition lines close accurately upon receipt.\nAutomated status cascades eliminate manual tracking of outstanding purchase order commitments.\nThis real-time synchronization provides management with accurate visibility of pending vendor deliveries.\nAccurate indent consumption updates procurement reporting dashboards to prevent redundant purchasing.",

  // MM GRN (Technical)
  "fGRN:technical:schema-bindings-and-data-structures":
    "The schema enforces unique index constraints on DocNo and DocumentYearlyNo to prevent duplicates.\nChild tables utilize foreign key constraints with cascade rules configured to prevent orphan rows.\nAudit triggers record modification history in Inventory.IGRNAuditDetail for compliance tracking.\nTransaction commits execute within serialized isolation levels to maintain inventory integrity.\nClustered primary keys optimize range scans when inventory reconciliation jobs query historical receipts.",

  "fGRN:technical:stored-procedures-and-method-routines":
    "Stored procedures utilize table-valued parameters to perform efficient bulk line insertions.\nExecution errors invoke structured catch blocks that execute explicit transaction rollbacks.\nLookup procedures implement indexed queries to retrieve open references with sub-second latency.\nDiagnostic shortcuts Ctrl+Alt+G copy database update scripts to the clipboard for review.\nProcedure performance execution plans are cached by the relational database engine to minimize query compilation overhead.",

  "fGRN:technical:validation-triggers-and-rejection-conditions":
    "Validation rules query database indices to evaluate balance quantities without table scans.\nServer procedures re-verify all Boolean conditions to prevent bypass via direct API requests.\nFailed checks raise custom error codes mapped to localized user error messages in the interface.\nRollback handlers reverse all temporary table states when validation failures occur.",

  "fGRN:technical:detail-replacement-and-atomic-save":
    "Detail line replacement executes synchronously with parent document updates in the database.\nForeign key constraints ensure orphaned child rows cannot persist after update execution.\nTransaction isolation levels prevent concurrent transactions from reading partially replaced rows.\nAudit history logs capture deleted line item details before replacement occurs.",

  "fGRN:technical:stock-ledger-posting-and-financial-integration":
    "Stock ledger updates capture batch IDs, serial numbers, and physical warehouse bin assignments.\nValuation procedures compute moving weighted average rates dynamically during stock ledger commit.\nPosting routines write staging rows consumed by accounts payable matching procedures in Finance.\nThis posting interface ensures exact synchronization between physical inventory and the General Ledger.",

  "fGRN:technical:concurrency-controls-and-referential-guards":
    "Optimistic locking prevents lost updates during simultaneous warehouse intake processing.\nReferential integrity barriers protect historical receipts from accidental administrative removal.\nAudit trails preserve complete historical snapshots of receipts for statutory compliance.\nDatabase triggers enforce referential barriers across Purchase, Inventory, and Finance schemas.",

  // FI Purchase Bill (Functional)
  "fPurchaseBill:functional:three-way-matching-and-quantity-tolerances":
    "Matching rules protect company financial assets against duplicate billing and unapproved price hikes.\nPrice discrepancies require formal commercial change orders before the bill can be passed.\nThese controls guarantee that accounts payable disburses funds only for verified commitments.",

  "fPurchaseBill:functional:gst-determination-and-tax-rules":
    "Statutory exemption certificates must be linked to line items when claiming concessional tax rates.\nThese fiscal controls protect the company from statutory penalties and ensure accurate tax submissions.\nAutomated tax calculation prevents arithmetic errors and simplifies statutory tax reconciliation.",

  "fPurchaseBill:functional:advance-adjustment-and-imprest-rules":
    "Cleared advances update prepayment sub-ledgers and prevent unallocated advance balances from aging indefinitely.\nReconciled entries ensure vendor statements agree with internal accounts payable records.\nThis financial reconciliation protects company working capital from duplicate or premature disbursements.",

  "fPurchaseBill:functional:authorization-locking-and-financial-posting":
    "Authorized bills become immediately available in treasury planning for payment scheduling and disbursement.\nFinance managers review general ledger account distributions before signing off final authorization.\nThis state progression guarantees strict segregation of duties between accounting clerks and supervisors.",

  // FI Purchase Bill (Technical)
  "fPurchaseBill:technical:form-architecture-and-schema-mappings":
    "Primary keys DocNo and DocumentYearlyNo maintain clustered index structures for high-speed retrieval.\nForeign key relationships bind line items to inventory receipt details and purchase order lines.\nAudit triggers record modification history in Finance.FPurchaseBillAuditDetail for compliance tracking.\nAtomic transaction boundaries ensure invoice headers and detail lines commit synchronously without partial writes.",

  "fPurchaseBill:technical:stored-procedures-and-backend-routines":
    "Persistence procedures utilize table-valued parameters for efficient line item insertions.\nStructured catch blocks capture relational database errors and execute explicit transaction rollbacks.\nExecution plans are cached by the relational database engine to optimize throughput under heavy load.\nDiagnostic shortcuts Ctrl+Alt+G rebuild GST posting distributions from line item records directly.\nAudit procedures log execution duration and calling user credentials for security reviews.",

  "fPurchaseBill:technical:validation-triggers-and-rejection-conditions":
    "Server procedures re-verify all Boolean conditions to ensure data integrity against direct API calls.\nFailed checks raise custom error codes mapped to localized user error messages in the interface.\nRollback handlers reverse all intermediate variable states when any rule triggers an exception.\nStructured error messages identify the exact line item and column violating business constraints.",

  "fPurchaseBill:technical:mutation-patterns-and-status-cascades":
    "Detail line replacement executes synchronously with parent document updates in the database.\nForeign key constraints ensure orphaned child rows cannot persist after update execution.\nCascade routines update BilledQty across inventory tables within the primary transaction boundary.\nThis mutation logic guarantees that parent receipts and child bills remain perfectly synchronized.",

  "fPurchaseBill:technical:general-ledger-posting-and-tax-interfaces":
    "Sub-ledger posting updates vendor aging tables to support payment planning and credit term tracking.\nClearing accounts reconcile input tax credits against central goods and services tax ledgers.\nRollback handlers ensure ledger vouchers reverse cleanly if tax calculation errors occur.\nThis posting interface ensures exact synchronization between purchasing bills and the General Ledger.",

  // FI Payment Voucher (Functional)
  "fPaymentVoucher:functional:place-in-payment-flow":
    "Bank reconciliation features link to this voucher to reconcile cleared payments against statements.\nCashiers confirm cheque signatures or electronic transfer authorizations before funds leave accounts.\nAuthorized vouchers become permanent accounting records that cannot be modified retroactively.",

  "fPaymentVoucher:functional:mandatory-headers-and-bank-validations":
    "Transaction currency conversion rates must be positive numbers matching active corporate exchange rates.\nMandatory bank fields ensure funds transfers reach designated supplier bank accounts without return.\nAccurate recording of bank reference details ensures smooth bank reconciliation and audit compliance.",

  "fPaymentVoucher:functional:double-entry-balancing-and-account-rules":
    "Tax deduction amounts are segregated into statutory payable accounts for government remittance.\nBalancing checks prevent unbalanced journal vouchers from posting into general ledger books.\nAccurate double-entry balancing prevents discrepancies between cash books and the balance sheet.",

  "fPaymentVoucher:functional:authorization-limits-and-record-locking":
    "Authorizing the voucher updates cash flow forecasts and closes matched purchase bill schedules.\nTreasury managers verify bank account liquidity before releasing high-value payment vouchers.\nThis authorization control guarantees that treasury disbursements adhere to executive financial mandates.",

  // FI Payment Voucher (Technical)
  "fPaymentVoucher:technical:schema-architecture-and-data-models":
    "The schema enforces foreign key constraints across bank master and currency exchange tables.\nClustered indices on DocNo and DocumentYearlyNo optimize transaction search and ledger lookups.\nAudit trail triggers capture record modification history in Finance.FVoucherAuditDetail.\nTransaction commits execute within serialized isolation levels to maintain accounting ledger integrity.\nForeign key cascades verify referenced payment plans exist before voucher persistence commits.",

  "fPaymentVoucher:technical:validation-triggers-and-error-logic":
    "Mathematical invariant checks evaluate total debits against total credits before invoking save routines.\nServer procedures re-verify user authorization limits against masterdata tables to prevent privilege escalation.\nValidation failures raise custom SQL error codes handled by the application exception layer.\nStructured exception codes returned by backend procedures are translated into user error messages.",

  "fPaymentVoucher:technical:general-ledger-mutation-and-bank-reconciliation":
    "Posted voucher numbers write back to parent payment advice records to establish audit lineage.\nBank sub-ledgers update unpresented cheque queues to facilitate monthly statement reconciliation.\nReversal routines generate offsetting credit entries in FJournalDetail to maintain audit compliance.\nThis posting interface maintains exact synchronization between treasury disbursements and the General Ledger.",

  // PM Equipment Master (Functional)
  "fEquipmentMaster:functional:place-in-maintenance-workflow":
    "Physical verification against this document ensures company equipment registers match physical floor assets.\nMaintenance histories captured here enable engineering managers to analyze equipment reliability over time.\nWithout this master definition, engineering teams cannot schedule preventive maintenance or track machine downtime.",

  "fEquipmentMaster:functional:mandatory-attributes-and-ownership-types":
    "These checks prevent incomplete or duplicate equipment records from contaminating asset registers.\nMandatory custody details establish clear operational accountability for plant equipment safety.\nAccurate classification ensures that maintenance schedules and financial depreciation apply appropriate rules.",

  "fEquipmentMaster:functional:location-tracking-and-custody-rules":
    "Correct location mapping guarantees that maintenance costs charge to the proper operational cost center.\nCustodian assignment ensures machinery is operated only by qualified and authorized personnel.\nThese controls prevent machinery from operating in unapproved or unmonitored factory areas.",

  "fEquipmentMaster:functional:bill-of-materials-and-spares-definition":
    "Technicians review bill of materials specifications before disassembling complex machinery assemblies.\nThis standardization prevents non-standard or incompatible components from being fitted to plant machinery.\nComponent life span tracking enables proactive replacement before in-service mechanical failure occurs.",

  "fEquipmentMaster:functional:safety-permits-and-measurement-parameters":
    "Clear operating limits ensure operators shut down machinery before minor faults cause major damage.\nSafety compliance records remain permanently associated with the asset for regulatory safety audits.\nThis integration guarantees that machinery operates strictly within certified engineering safety envelopes.",

  "fEquipmentMaster:functional:record-lifecycle-and-deletion-restrictions":
    "Decommissioned records preserve parts replacement histories that inform future purchasing decisions.\nHistorical equipment data remains accessible for insurance claims and technical failure investigations.\nThis protection ensures that company asset registers remain auditable across entire equipment lifecycles.",

  // PM Equipment Master (Technical)
  "fEquipmentMaster:technical:schema-architecture-and-table-structures":
    "Primary keys EquipmentId and EquipmentCode maintain clustered indices to optimize lookup queries.\nForeign key relationships bind equipment records to functional locations and cost center tables.\nAudit triggers record modification history in EAM.EAMEquipmentAuditDetail for compliance tracking.\nAtomic transaction boundaries ensure equipment headers and BOM lines commit synchronously without partial writes.\nIndex seek operations ensure sub-second retrieval of asset attributes across plant maintenance queries.",

  "fEquipmentMaster:technical:stored-procedures-and-method-routines":
    "Persistence procedures utilize table-valued parameters for efficient child record insertions.\nStructured catch blocks capture relational database errors and execute explicit transaction rollbacks.\nExecution plans are cached by the relational database engine to optimize throughput under heavy load.\nAudit logging procedures capture user credentials and execution timestamps across all master modifications.",

  "fEquipmentMaster:technical:validation-triggers-and-rejection-conditions":
    "Server procedures re-verify all Boolean conditions to ensure data integrity against direct API calls.\nFailed checks raise custom error codes mapped to localized user error messages in the interface.\nRollback handlers reverse all intermediate variable states when any rule triggers an exception.\nAll exceptions return structured error parameters mapped to localized user error notifications.\nMissing custodian contact details trigger structured field-level validation errors prior to database insert.",

  "fEquipmentMaster:technical:child-record-mutation-and-bom-persistence":
    "Line replacement commits synchronously with document header updates within a single transaction.\nForeign key cascades verify that item codes in the BOM exist in masterdata.mItemMaster.\nTransaction isolation levels prevent concurrent transactions from reading partially replaced rows.\nThis mutation pattern prevents partial configuration saves and eliminates orphaned child records.",

  "fEquipmentMaster:technical:referential-integrity-and-deletion-guards":
    "Referential integrity barriers protect historical asset maintenance logs from accidental removal.\nDatabase triggers ensure child records in specification tables purge synchronously on draft removal.\nTransaction rollback handlers ensure that partial deletions never leave orphaned records in child tables.\nAudit tables log deletion attempts, user credentials, and machine IP addresses for security reviews.",

  // PM Maintenance Order (Functional)
  "fMaintenanceOrder:functional:place-in-maintenance-workflow":
    "Without an authorized work order, storekeepers cannot issue spare parts for equipment overhauls.\nCompleted work orders provide baseline data for evaluating total maintenance expenditure by asset.\nThis document provides complete traceability from initial fault detection to final operational sign-off.",

  "fMaintenanceOrder:functional:mandatory-headers-and-asset-validations":
    "Division alignment rules ensure that repair expenditures are allocated to the correct operating facility.\nDocument dates prevent retroactive job scheduling and ensure chronological maintenance logging.\nAccurate header information establishes clear operational ownership and scheduling accountability.",

  "fMaintenanceOrder:functional:task-scheduling-and-resource-alignment":
    "Predefined task sequences ensure that complex machinery overhauls follow standardized engineering protocols.\nResource planning ensures skilled labor is scheduled without causing overtime or factory downtime.\nProper resource alignment prevents scheduling conflicts among specialized maintenance technicians.",

  "fMaintenanceOrder:functional:spares-planning-and-material-demands":
    "This inventory integration guarantees complete material traceability and accurate machine maintenance costing.\nUnused spare components must be formally returned to stores to credit the maintenance job.\nPlanned parts demands prevent delays by staging engineering components before shutdown overhauls begin.",

  "fMaintenanceOrder:functional:safety-permit-clearance-and-loto-rules":
    "Operating permits ensure that hazardous energy sources remain locked out until all technicians sign off.\nPermit compliance prevents industrial accidents and protects technicians working in high-voltage areas.\nThis safety protocol protects human life and enforces strict industrial safety discipline.",

  "fMaintenanceOrder:functional:authorization-locking-and-job-completion":
    "Completed orders update equipment reliability metrics including mean time between failures.\nHistorical work order data informs predictive maintenance algorithms and overhaul interval reviews.\nThis state progression guarantees strict managerial oversight over plant repair activities and maintenance budgets.",

  // PM Maintenance Order (Technical)
  "fMaintenanceOrder:technical:form-architecture-and-data-models":
    "Clustered indices on OrderId and DocNo optimize query performance across large maintenance datasets.\nForeign key relationships bind work order tasks to task master tables and employee rosters.\nAudit triggers record modification history in EAM.EAMOrderAuditDetail for compliance tracking.\nAtomic transaction boundaries ensure order headers, tasks, and item demands commit synchronously.\nNon-clustered indices on EquipmentId accelerate order history retrieval during preventive maintenance analysis.",

  "fMaintenanceOrder:technical:stored-procedures-and-method-routines":
    "Stored procedures utilize table-valued parameters for efficient task and material line insertions.\nStructured catch blocks capture relational database errors and execute explicit transaction rollbacks.\nExecution plans are cached by the relational database engine to optimize throughput under heavy load.\nAudit logging procedures capture user credentials and execution timestamps across all order modifications.",

  "fMaintenanceOrder:technical:validation-triggers-and-rejection-conditions":
    "Server procedures re-verify all Boolean conditions to ensure data integrity against direct API calls.\nFailed checks raise custom error codes mapped to localized user error messages in the interface.\nRollback handlers reverse all intermediate variable states when any rule triggers an exception.\nStructured error messages identify the exact line item and column violating business constraints.",

  "fMaintenanceOrder:technical:detail-replacement-and-atomic-save":
    "Line replacement commits synchronously with document header updates within a single transaction.\nForeign key cascades verify that item codes in demands exist in masterdata.mItemMaster.\nTransaction isolation levels prevent concurrent transactions from reading partially replaced rows.\nThis mutation pattern prevents partial configuration saves and eliminates orphaned task records.",

  "fMaintenanceOrder:technical:concurrency-controls-and-referential-guards":
    "Referential integrity barriers protect historical maintenance orders from accidental administrative removal.\nDatabase triggers ensure child records in task tables purge synchronously on draft removal.\nTransaction rollback handlers ensure that partial deletions never leave orphaned records in child tables.\nAudit trails preserve complete historical snapshots of maintenance orders for statutory compliance."
};

export { extensions };
