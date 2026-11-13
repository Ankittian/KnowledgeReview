import { CardFile } from "./generate-gemini-cards";

export const mmCardFiles: CardFile[] = [
  // ==========================================
  // MODULE: MM (EASY: 20-70 words, 3-4 lines)
  // ==========================================
  {
    scope: "module",
    key: "MM",
    title: "Material Management",
    context: "Material Management",
    module: "MM",
    audience: "functional",
    cards: [
      {
        level: "easy",
        topic_key: "module-purpose",
        title: "What Material Management covers in the ERP",
        body: "Material Management controls the lifecycle of goods from sourcing to consumption.\nIt manages vendor requests, quotations, orders, warehouse receipts, and store issues.\nThe module ensures purchases match authorized demand and that inventory stays accounted for.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "procure-to-pay-lifecycle",
        title: "The core procurement lifecycle from request to receipt",
        body: "Procurement begins when an internal department raises a formal material request.\nBuyers invite vendor prices, evaluate them side by side, and place authorized purchase orders.\nGoods arrive at the factory gate and enter warehouse stock through a verified receipt.",
        source_refs: ["process:procure-to-pay"]
      },
      {
        level: "easy",
        topic_key: "quality-inspection-lifecycle",
        title: "Quality verification before goods enter usable stock",
        body: "Material arriving at the gate undergoes inspection before entering usable inventory.\nStorekeepers raise inspection intimations to notify quality teams of incoming consignments.\nOnly accepted quantities increase available stock, while rejected items are isolated.",
        source_refs: ["process:goods-receipt-quality-inspection"]
      },
      {
        level: "easy",
        topic_key: "inventory-storage-and-issue",
        title: "Warehouse storage and material issue to operations",
        body: "Accepted materials are placed in designated warehouse locations and tracked by bin.\nDepartments request spares and consumable supplies using authorized internal requests.\nIssued stock reduces warehouse balance and charges the expense to the requesting cost center.",
        source_refs: ["process:inventory-storage"]
      },
      {
        level: "easy",
        topic_key: "material-classification-hierarchy",
        title: "Four-level material master classification hierarchy",
        body: "Items are organized under a strict four-level structure to ensure consistent reporting.\nCategory forms the top level, followed by Group and Sub Group for technical attributes.\nThe Item represents the individual stocked product linked to its approved suppliers.",
        source_refs: ["concept:material-category", "concept:material-group", "concept:material-sub-group", "concept:material-item"]
      },
      {
        level: "easy",
        topic_key: "finance-integration-hand-off",
        title: "Where Material Management hands over to Finance",
        body: "Goods received in stores create valued receipt records that pass to Finance.\nThe Finance team books supplier purchase bills directly against these receipt records.\nPayment requests, payment plans, and vouchers settle vendor balances based on these receipts.",
        source_refs: ["process:payment-flow", "hand_offs"]
      },
      {
        level: "easy",
        topic_key: "plant-maintenance-hand-off",
        title: "Where Material Management hands over to Plant Maintenance",
        body: "Maintenance teams require engineering spares and equipment parts for preventive work.\nStores issue requested parts against authorized maintenance work orders.\nSpares consumption updates maintenance repair costs and decreases warehouse inventory.",
        source_refs: ["process:preventive-maintenance", "hand_offs"]
      },
      {
        level: "easy",
        topic_key: "vendor-master-governance",
        title: "Vendor master setup governs all procurement activities",
        body: "Procurement is restricted to approved commercial business partners and verified locations.\nVendor profiles establish valid tax locations, payment currencies, and authorized contacts.\nPurchase orders cannot be issued to unapproved suppliers or unmapped locations.",
        source_refs: ["process:vendor-master-setup", "rule:approved-vendor-restriction"]
      }
    ]
  },
  {
    scope: "module",
    key: "MM",
    title: "Material Management",
    context: "Material Management",
    module: "MM",
    audience: "technical",
    cards: [
      {
        level: "easy",
        topic_key: "technical-architecture-and-schemas",
        title: "Core schemas and entity architecture of Material Management",
        body: "The Material Management module operates across the Purchase and Inventory database schemas.\nPurchase transactions populate header tables such as PMPurchaseOrder and detail tables like PMIndentDetail.\nInventory storage and movement records write to IGRNMain, IItemMaster, and IStockPosting entries.",
        source_refs: ["summary", "description"]
      },
      {
        level: "easy",
        topic_key: "centralized-master-dependencies",
        title: "Centralized master dependencies and shared lookups",
        body: "MM transaction forms depend on shared masters including masterdata.mItemMaster and masterdata.mAccountGroup.\nCurrency exchange rates are resolved from GlobalData.CurrencyMaster and applied during PO valuation.\nVendor locations map to Finance books through the shared GlobalData.VendorLocationSelect lookup routine.",
        source_refs: ["concept:material-item", "concept:vendor", "concept:currency-exchange-rate"]
      },
      {
        level: "easy",
        topic_key: "financial-ledger-integration",
        title: "Posting boundaries between inventory movements and General Ledger",
        body: "Inventory transactions generate financial vouchers using Account Determination Rules (ARD).\nMaterial receipts invoke Inventory.IGRNFinancePosting to create valued journal vouchers.\nFinancial integration verifies division mapping and accounting period lock flags prior to ledger commit.",
        source_refs: ["rule:finance-posting-from-transactions", "concept:account-determination-rule"]
      },
      {
        level: "easy",
        topic_key: "document-lineage-and-references",
        title: "Document lineage tracking via reference headers and line IDs",
        body: "Transaction lineage flows from Indent to RFQ, Quotation, PO, Gate Entry, and GRN.\nEach child document stores the parent document type and yearly document number in RefDocType and RefDocNo.\nStatus cascades decrement balance quantities on parent detail lines during transaction authorization.",
        source_refs: ["rule:document-numbering", "process:procure-to-pay"]
      },
      {
        level: "easy",
        topic_key: "extensible-custom-fields-framework",
        title: "Shared custom fields framework integration across MM forms",
        body: "MM transaction headers integrate the shared UserControl CustomField for extensible user attributes.\nField values load via masterdata.customfieldsloaddata and save through masterdata.customfieldssave.\nCustom attribute validation executes dynamically without modifying core transaction table schemas.",
        source_refs: ["rule:custom-fields-capture", "usercontrol:CustomField"]
      },
      {
        level: "easy",
        topic_key: "concurrency-and-locking-controls",
        title: "Optimistic concurrency locking and audit trail mechanics",
        body: "All MM transaction records enforce optimistic locking using ModifiedDate and ModifiedBy timestamps.\nConcurrent modifications trigger reload warnings to prevent overwriting conflicting updates.\nAuthorized transactions lock key header fields and set document status flags to prevent deletion.",
        source_refs: ["rule:authorized-document-lock", "rule:atomic-save"]
      }
    ]
  },

  // ==========================================
  // FLOW: MM (MEDIUM: 90-200 words, 6-10 lines)
  // ==========================================
  {
    scope: "flow",
    key: "procure-to-pay",
    title: "Procure-to-Pay (PO Flow)",
    context: "Material Management › Procure-to-Pay (PO Flow)",
    module: "MM",
    audience: "functional",
    cards: [
      {
        level: "medium",
        topic_key: "ten-step-procurement-sequence",
        title: "Ten-step progression of the Procure-to-Pay workflow",
        body: "The procurement workflow follows a strict sequence of ten sequential stages to convert operational needs into stocked goods.\nIt starts with defining Purchase Organizations and Material Sub Groups with approved suppliers before purchasing begins.\nA requesting department raises a Material Request, which converts into an Indent if warehouse stores cannot fulfill it.\nThe purchasing buyer issues a Request for Quotation to eligible vendors, enters received quotes, and compares them side by side on a CS.\nThe authorized Purchase Order is then officially released and placed with the winning approved supplier.\nThe physical consignment arrives at the factory entrance where security personnel record the vehicle during Gate Entry.\nThe workflow concludes when warehouse staff verify delivered goods and sign off the Material Receipt Note in stores.\nIn summary, departmental demand moves from internal request to indent, competitive quotation, purchase order, gate arrival, and final stores receipt.",
        source_refs: ["steps", "summary", "description"]
      },
      {
        level: "medium",
        topic_key: "roles-and-responsibilities",
        title: "Cross-functional roles throughout the procurement process",
        body: "Different operational departments collaborate closely to maintain separation of duties across all purchasing activities.\nDepartment requesters identify required operational supplies and initiate internal requisitions for necessary items.\nPurchase managers configure buying organizations, define vendor eligibility guidelines, and grant commercial authorization.\nPurchase officers negotiate commercial terms, collect vendor quotes, perform cost comparisons, and create purchase orders.\nSecurity staff record arriving delivery vehicles at the factory entrance to document arrival times and consignment weights.\nWarehouse storekeepers physically inspect delivered materials, count packages, and sign off the final receipt note into stock.\nThis separation ensures no single individual can initiate, approve, receive, and pass goods without independent verification.\nEvery milestone produces an auditable record connecting the original requester to the receiving storekeeper.",
        source_refs: ["steps", "used_by"]
      },
      {
        level: "medium",
        topic_key: "prerequisite-master-configurations",
        title: "Mandatory master setups required before purchasing begins",
        body: "Operational purchasing cannot begin until administrative foundations and master records are properly established.\nPurchase Organizations must be configured to group participating operational divisions into recognized buying entities.\nEach Material Sub Group must explicitly define authorized suppliers and certified manufacturing makes for item families.\nMaterial master records must specify valid inventory stocking units, purchasing units, and non-zero conversion ratios.\nEvery purchased item must be assigned an active tax chapter heading to ensure correct statutory tax calculation downstream.\nAttempts to raise purchase requests for unclassified items or unapproved suppliers are immediately stopped by system checks.\nThese prerequisite setups guarantee that subsequent purchasing transactions inherit consistent commercial terms and tax profiles.\nWithout these master definitions, the purchasing team cannot convert requisitions into valid commercial commitments.",
        source_refs: ["step:1", "step:2", "rule:approved-vendor-restriction"]
      },
      {
        level: "medium",
        topic_key: "quotation-evaluation-stage",
        title: "Competitive vendor bidding and comparative evaluation",
        body: "Commercial evaluation ensures competitive pricing, quality compliance, and adherence to approved departmental budgets.\nThe Request for Quotation invites priced bids from approved suppliers for specified quantities and required delivery dates.\nSupplier responses are entered into the system under individual quotation records detailing unit rates, freight, and payment terms.\nThe Comparative Statement compiles bids side by side, evaluating total delivered costs including taxes and transportation charges.\nThe purchasing team reviews supplier payment terms, delivery schedules, and historical performance before making a selection.\nThe buyer selects the optimal supplier bid on the comparison sheet to generate the legally binding Purchase Order.\nThis structured bidding stage ensures transparency in vendor selection and prevents unauthorized purchasing at inflated rates.\nEvery generated purchase order remains traceable back to the comparative analysis that justified the award.",
        source_refs: ["step:5", "step:6", "step:7", "concept:comparative-statement"]
      },
      {
        level: "medium",
        topic_key: "gate-entry-and-stores-receipt",
        title: "Factory gate intake and warehouse stock acceptance",
        body: "When goods physically arrive at the company facility, security personnel inspect the consignment delivery challan.\nThe Gate Entry records the vehicle registration, driver information, delivery challan number, and gross vehicle weighment.\nThis gate record acts as the mandatory prerequisite for warehouse storekeepers to initiate the formal receipt note.\nStorekeepers verify delivered goods against the authorized purchase order and the incoming gate entry document.\nAccepted quantities increase available warehouse inventory, while damaged or non-conforming items are rejected.\nThe receipt note automatically updates the received quantity on the gate entry and decrements open balance on the purchase order.\nPhysical verification against this document ensures company inventory records match actual deliveries received in stores.\nThis stage safely transfers custody of materials from external transporters to internal warehouse personnel.",
        source_refs: ["step:9", "step:10", "concept:gate-entry", "concept:goods-receipt-note"]
      },
      {
        level: "medium",
        topic_key: "downstream-flow-continuations",
        title: "Transitions into quality inspection and supplier settlement",
        body: "The Procure-to-Pay process concludes by handing transaction data over to two subsequent operational flows.\nReceived items requiring technical verification trigger Goods Receipt and Quality Inspection within Material Management.\nStorekeepers raise an inspection intimation notifying quality engineers that incoming lots require parameter testing.\nSimultaneously, the verified receipt note passes to Finance to initiate the supplier Payment Flow.\nAccounts officers match incoming supplier invoices against the receipt note before authorizing financial disbursement.\nThis integration guarantees that supplier payments are released only for physically verified and accepted inventory.\nMaterial Management thus serves as the operational bridge connecting factory intake with financial accounting.\nBoth subsequent flows depend entirely upon the accuracy of the receipt note generated at the end of procurement.",
        source_refs: ["leads_to", "process:goods-receipt-quality-inspection", "process:payment-flow"]
      }
    ]
  },
  {
    scope: "flow",
    key: "procure-to-pay",
    title: "Procure-to-Pay (PO Flow)",
    context: "Material Management › Procure-to-Pay (PO Flow)",
    module: "MM",
    audience: "technical",
    cards: [
      {
        level: "medium",
        topic_key: "document-lineage-and-key-propagation",
        title: "Foreign key propagation across the procurement document hierarchy",
        body: "Procurement transactions establish an unbroken relational hierarchy using yearly document identifiers across schemas.\nfIndent captures departmental demand, which fRequestforQuotation references through IndentNo and IndentDate foreign keys.\nVendor bids recorded in fQuotation store RFQNo and VendorLocationId to preserve source commercial context.\nfCS aggregates quote IDs, evaluates line item prices, and passes selected vendor attributes into fPurchaseOrder.\nPurchase order detail rows retain RefDocType, RefDocNo, and ItemId to preserve full traceability back to the indent.\nfGateEntry registers arriving shipments by linking to the purchase order number and vendor location master.\nfGRN consumes GateEntryNo and PONo in header records, ensuring line items validate against authorized order balances.\nThis relational key propagation ensures complete lineage reporting from requisition through stores receipt.",
        source_refs: ["steps", "concept:purchase-order", "concept:purchase-request"]
      },
      {
        level: "medium",
        topic_key: "status-cascade-and-quantity-consumption",
        title: "Line item status recalculation and balance consumption logic",
        body: "Downstream document authorization decrements open balances on parent records through transactional cascades.\nAuthorizing fPurchaseOrder decrements BalanceQty and updates reserved demand on corresponding fIndent detail rows.\nWhen fGateEntry references a purchase order, validation routines lock order lines against concurrent gate duplication.\nAuthorizing fGRN decrements remaining open order quantities and transitions PO line status to Closed upon complete receipt.\nWhen full quantities across all lines are received, header status on fPurchaseOrder transitions to Completed.\nIf an unauthorized receipt note is edited or cancelled, cascade handlers restore parent purchase order balances immediately.\nStatus recalculations execute within atomic database transactions to ensure consistency between orders and receipts.\nThis synchronization prevents accidental over-ordering, duplicate gate entries, and conflicting stores receipts.",
        source_refs: ["rule:material-receipt-note-source-status-cascade", "rule:atomic-save"]
      },
      {
        level: "medium",
        topic_key: "shared-routines-and-numbering-services",
        title: "Standardized document numbering and stored procedure architecture",
        body: "Every document in the flow generates sequential identifiers through standardized numbering stored procedures.\nDocument number generation evaluates prefix, financial year, and division mapping parameters from system settings.\nHeader and detail operations execute through specialized stored procedures such as Purchase.PMPOSave and IGRNSave.\nLookup datasets and dependent dropdown filters populate via routines like Purchase.PMPOFillValues and IGRNFillValues.\nDelete operations invoke cascade handlers like Purchase.PMPODelete to verify dependent child references before row removal.\nShared validation routines execute server-side within custom validation procedures prior to transaction commit.\nStructured exception codes returned by backend procedures are translated into user notifications by the application layer.\nThis modular architecture ensures uniform transaction processing and auditing across all procurement stages.",
        source_refs: ["rule:document-numbering", "method_notes"]
      },
      {
        level: "medium",
        topic_key: "approval-matrix-and-authorization-states",
        title: "Multi-tier approval workflows and authorization group schemas",
        body: "Procurement records transition across Initial, Release, and Authorized lifecycle states during processing.\nAuthorization groups enforce user tier limits configured in masterdata.mAuthorizationGroup and linked user tables.\nIntermediate approvers record sign-offs in approval audit tables without changing document state to Authorized.\nThe document remains in Release status until all required approval hierarchy tiers complete their review.\nOnly the designated final approver can trigger the transition of DocumentStatus to Authorized in the database.\nAuthorized status fires database triggers that make header and detail rows immutable against direct updates.\nDocument amendments create linked records in amendment tables, preserving previous revisions for compliance audits.\nThis state machine guarantees that commercial commitments adhere strictly to enterprise financial delegation matrices.",
        source_refs: ["rule:authorized-document-lock", "rule:material-receipt-note-multi-level-authorization"]
      },
      {
        level: "medium",
        topic_key: "financial-and-inventory-interface-boundary",
        title: "Interface mechanics between purchase receipt and general ledger posting",
        body: "Receipt authorization executes dual updates across inventory ledger and financial staging tables simultaneously.\nStock posting increments physical on-hand quantities within the Inventory.IStockLedger table for accepted items.\nConcurrently, Account Determination Rules (ARD) evaluate item sub groups to identify debit and clearing accounts.\nValued receipt lines invoke Inventory.IGRNFinancePosting to create journal entries and staging lines for accounts payable.\nStaging records write to Finance schema tables, making quantities and values available for consumption by fPurchaseBill.\nIf inspection rejected quantities exist, quarantine stock ledgers isolate the material pending dispatch returns.\nRollback handlers ensure inventory additions and financial staging records commit synchronously within a single transaction.\nThis interface boundary guarantees that physical stock movements match financial balance sheet valuations.",
        source_refs: ["rule:finance-posting-from-transactions", "concept:account-determination-rule"]
      }
    ]
  },

  // ==========================================
  // FORMS: MM (HARD: 180-380 words, 10-20 lines)
  // ==========================================
  {
    scope: "form",
    key: "fPurchaseOrder",
    title: "Purchase Order",
    context: "Material Management › Procure-to-Pay (PO Flow) › Purchase Order",
    module: "MM",
    audience: "functional",
    cards: [
      {
        level: "hard",
        topic_key: "place-in-procurement-flow",
        title: "Where the Purchase Order sits in the procurement workflow",
        body: "The Purchase Order represents step eight in the ten-step procurement sequence within Material Management.\nIt immediately follows the Comparative Statement where vendor quotes are analyzed and ranked.\nUpon creation, the purchase order becomes the official commercial commitment issued to the approved supplier.\nThe next physical step in the workflow is Gate Entry when ordered goods arrive at the factory gate.\nPurchase officers draft the order, while authorized purchase managers grant final commercial approval.\nThe order takes approved rates and delivery schedules from preceding quotations and departmental indents.\nAuthorized purchase orders serve as the mandatory reference for incoming consignments at the factory gate.\nWithout an authorized order, security personnel cannot log incoming consignments into the facility.\nDelivery schedules, freight conditions, and payment terms recorded here govern downstream receipt and billing.\nThe order ensures all organizational procurement adheres strictly to approved budgets and operational authorizations.\nPhysical verification against this document ensures company commitments match agreed commercial terms.\nOnce released, the purchase order provides legal documentation protecting both buyer and supplier interests.",
        source_refs: ["summary", "purpose", "process:procure-to-pay", "used_by"]
      },
      {
        level: "hard",
        topic_key: "mandatory-commercial-requirements",
        title: "Mandatory commercial header fields and reference selections",
        body: "The system enforces strict completeness rules before a purchase order can be saved in the system.\nThe user must select a valid document type, purchase category, and reference document type from master options.\nSelecting a verified vendor and associated location is mandatory for all procurement transactions.\nThe validity date must be specified and cannot precede the current document date under any circumstances.\nIf the validity date is earlier than the document date, the system immediately halts the save operation.\nA valid operational department and purchase organization must be linked to establish internal accountability.\nIf the vendor contact person is missing, the system prompts the user with an explicit confirmation warning.\nWhen referencing an existing contract, the document date must fall strictly within the active contract period.\nDuplicate document numbers are prohibited by automated yearly numbering validation enforced on save.\nEvery purchase order must link to at least one valid line item with positive quantity and agreed unit price.\nMissing mandatory headers halt saving and highlight the exact commercial information requiring user entry.\nThese checks prevent incomplete or unauthorized purchase orders from being dispatched to external vendors.",
        source_refs: ["fields", "messages", "validations", "rule:mandatory-document-fields"]
      },
      {
        level: "hard",
        topic_key: "line-item-tolerances-and-rates",
        title: "Quantity tolerance thresholds and item rate integrity checks",
        body: "Every line item must satisfy defined commercial tolerances, item specifications, and rate validation checks.\nOrdered quantities cannot exceed the remaining open balance of the referenced indent or quotation.\nNegative tolerance cannot equal or exceed one hundred percent of the line quantity on any row.\nPositive tolerance governs the maximum acceptable over-delivery during subsequent warehouse receipt.\nThe unit rate cannot be left empty or set to zero for standard commercial purchase lines.\nWhen standard rate validation is enabled, the entered rate cannot exceed the master standard rate.\nItems classified as capital goods cannot be mixed with standard operational consumables on the same order.\nDuplicate items sharing identical technical specifications and makes are prevented on the same document.\nConversion factors between purchasing and stocking units must be non-zero positive numbers.\nThese checks prevent over-ordering and enforce adherence to negotiated corporate purchasing agreements.\nTolerance parameters protect the business against unexpected price escalations and unauthorized vendor over-shipments.\nEvery line item must also link to an active tax classification heading before commercial authorization.",
        source_refs: ["validations", "rule:receipt-tolerance", "rule:approved-vendor-restriction"]
      },
      {
        level: "hard",
        topic_key: "multi-level-authorization-and-locking",
        title: "Authorization workflow stages and record locking mechanisms",
        body: "Purchase orders move through three distinct operational states: Initial, Release, and Authorized.\nNewly created orders reside in Initial status where field modifications remain unlocked for editing.\nSubmitting for approval advances the status to Release, locking general editing for regular purchasing clerks.\nUnder multi-tier authorization groups, each designated manager must log approval sequentially by tier.\nThe system halts approval if an intermediate user attempts to bypass preceding approval levels.\nThe document status cannot be manually marked Authorized under multi-tier workflows.\nOnly the final designated approval level transitions the order into Authorized status.\nOnce authorized, the purchase order is completely locked against direct edits, line modifications, or deletion.\nIf amendments are required, an authorized amendment document must be raised through formal revision channels.\nCancelled or completed purchase orders cannot be re-authorized or modified by any user in the organization.\nThis state progression ensures that purchasing commitments undergo rigorous executive review before vendor issuance.\nLocked records preserve an immutable audit trail for internal accounting and external financial compliance.",
        source_refs: ["validations", "rule:authorized-document-lock", "rule:atomic-save"]
      },
      {
        level: "hard",
        topic_key: "transportation-route-and-freight-rules",
        title: "Logistics routing parameters and freight expense controls",
        body: "Logistics details establish freight liabilities, carrier responsibilities, and physical delivery destinations.\nUsers specify transportation mode, freight payment responsibility, and verified delivery locations.\nThe system prevents the origin location and destination location from being identical on any route.\nFreight expenses cannot be defined concurrently as both a fixed amount and an independent freight order.\nTransportation routes cannot be assigned to orders categorized under capital procurement.\nWhen discrete raw materials are selected, standard transportation routing is disallowed by system checks.\nConsignee delivery locations must be valid and linked to active company operational divisions.\nFreight charges defined on the order automatically default into subsequent receipt documents for reconciliation.\nThese logistics rules ensure accurate cost allocation and clear carrier responsibilities across transport legs.\nInaccurate route definitions prevent transaction saving until location and expense conflicts are resolved.\nCorrect logistics mapping ensures arriving consignments are directed smoothly to the correct factory unloading bay.\nTransportation terms established here govern how freight invoices are later passed in accounts payable.",
        source_refs: ["validations", "fields", "purpose"]
      },
      {
        level: "hard",
        topic_key: "tax-determination-and-advance-adjustments",
        title: "Goods and services tax determination and vendor advance rules",
        body: "Tax structures are evaluated automatically based on vendor registration and company delivery site.\nInterstate purchases require integrated tax, while intrastate purchases apply central and state taxes.\nApplying state tax to an interstate purchase triggers an immediate validation refusal on save.\nEach line item must possess an active harmonized system code linked to the material item master.\nWhen vendor advances exist, users can allocate open advance balances against the purchase order.\nThe adjusted advance amount cannot exceed the open balance of the referenced advance payment.\nTotal advance adjustments cannot exceed the net payable commercial value of the purchase order.\nUnadjusted advances generate confirmation warnings prior to completing the save operation.\nTax concessions require valid statutory exemption forms to be linked to the tax schedule.\nAccurate tax and advance reconciliation prevents invoice disputes during financial settlement in accounts payable.\nThese fiscal controls ensure full compliance with national revenue authorities and statutory tax reporting.\nCorrect tax scheduling guarantees that input tax credits are claimed accurately by the finance team.",
        source_refs: ["validations", "rule:gst-tax-determination", "fields"]
      },
      {
        level: "hard",
        topic_key: "deletion-restrictions-and-operational-safeguards",
        title: "System deletion prohibitions and dependency safeguards",
        body: "The system enforces referential integrity to protect active commercial commitments and audit lineage.\nA purchase order cannot be deleted if subsequent amendment entries have been recorded against it.\nOrders created against letters of intent cannot be deleted while the letter remains active.\nIf a vendor advance payment request has been prepared against the order, deletion is blocked.\nThe presence of an active bank guarantee tied to the order also prevents document deletion.\nAuthorized orders cannot be removed from the system under any operational circumstances.\nAttempting to delete a referenced order generates an explicit system refusal message detailing dependencies.\nThese restrictions prevent accidental removal of legally binding corporate agreements and procurement history.\nUsers must formally cancel open line balances rather than attempting to delete historical records.\nAudit trails preserve all authorized order history for financial compliance, internal audit, and supplier tracking.\nDeleting draft records is restricted to authorized purchasing personnel before commercial release.\nThis referential protection guarantees that upstream indents and downstream receipts remain perfectly synchronized.",
        source_refs: ["validations", "rule:atomic-save", "purpose"]
      }
    ]
  },
  {
    scope: "form",
    key: "fPurchaseOrder",
    title: "Purchase Order",
    context: "Material Management › Procure-to-Pay (PO Flow) › Purchase Order",
    module: "MM",
    audience: "technical",
    cards: [
      {
        level: "hard",
        topic_key: "form-architecture-and-data-layers",
        title: "Form architecture, table bindings, and data layers of fPurchaseOrder",
        body: "fPurchaseOrder is a primary transaction interface residing within the Material Management module.\nHeader attributes map to Purchase.PMPurchaseOrder while line items bind to Purchase.PMPOIndentDetail.\nAssociated expense splits and freight routes persist in Purchase.PMPOExpense and Purchase.PMPORoute.\nTax line calculations write to the shared tax repository Finance.TDCTransactionDetail.\nOptimistic locking relies on ModifiedDate and ModifiedBy columns evaluated during update execution.\nUI section controls encapsulate distinct child datasets loaded asynchronously upon user navigation.\nShared custom fields interface through masterdata.customfieldssave during the primary transaction commit.\nLookup controls populate via GlobalData.VendorLocationSelect and Purchase.PMPOFillValues procedures.\nAtomic transaction scopes ensure header and child records roll back completely on execution failure.\nEntity state management coordinates with document status flags Initial, Release, and Authorized.\nDatabase triggers prevent direct row updates when DocumentStatus is marked Authorized in the header.\nForeign key constraints enforce referential integrity against item, vendor, and location master tables.",
        source_refs: ["method_notes", "summary", "concept:purchase-order"]
      },
      {
        level: "hard",
        topic_key: "stored-procedures-and-routine-bindings",
        title: "Stored procedure bindings for load, save, delete, and lookup operations",
        body: "All backend operations on fPurchaseOrder execute through dedicated stored procedures in the Purchase schema.\nRecord searches execute through Purchase.PMPOSearchData returning paginated document headers.\nSelected records load via Purchase.PMPOFillValues and Purchase.PMPOFillValuesDependent.\nIndent line details populate through Purchase.PMPOIndentDetail and Purchase.PMPOGetIndentItemDetail.\nFreight logistics parameters are retrieved through the stored procedure Purchase.PMPOFreightOrderDetail.\nQuality parameters linked to item lines load through the routine Purchase.GetSpecificationDetail.\nRecord deletion invokes Purchase.PMPODelete which enforces child dependency validation before row removal.\nCustom validation routines execute through the external procedure ODTPurchaseOrder.ProcedureName.\nAccount assignments resolve dynamically using Purchase.PMPOFillValuesAccountAssignment.\nAll stored procedures return structured error codes handled by the application exception layer.\nTransaction commits execute within serialized isolation levels to ensure consistent record persistence.\nAudit logging procedures capture user credentials and execution timestamps across all data modifications.",
        source_refs: ["method_notes", "validations"]
      },
      {
        level: "hard",
        topic_key: "validation-triggers-and-error-conditions",
        title: "Validation logic and Boolean condition triggers in fPurchaseOrder",
        body: "Form validation routines evaluate business rules prior to executing persistence routines in the database.\nValidityDate < DocumentDate raises a blocking validation error stopping transaction execution.\nFromLocationId == ToLocationId triggers validation refusal during transportation route configuration.\nPOQty > BalanceIndentQty triggers an exception preventing line item over-allocation against source indents.\nNegativeTolerance >= 100 or NegativeTolerance >= POQty aborts transaction processing.\nGST validation evaluates CompanyStateId against VendorStateId to enforce CGST/SGST versus IGST.\nUnitRate <= 0 triggers validation failure unless zero-rate flags are explicitly configured.\nMissing HSN codes on item masters trigger HSNSAC Code is not defined exceptions.\nConcurrent edits trigger optimistic locking errors when ModifiedDate mismatches database state.\nValidation checks execute sequentially within client validation before invoking backend procedures.\nState transitions verify user permission mappings against authorization group tables before updating status.\nFailure at any validation stage rolls back temporary variables and returns structured diagnostic messages.",
        source_refs: ["validations", "rule:receipt-tolerance", "rule:approved-vendor-restriction"]
      },
      {
        level: "hard",
        topic_key: "line-item-persistence-and-cascade-logic",
        title: "Child record mutation logic and status cascading mechanisms",
        body: "Transaction modifications execute a delete-and-reinsert pattern for detail line items in the database.\nExisting records in Purchase.PMPOIndentDetail are cleared and regenerated from current inputs.\nCascade routines update parent indent balances by decrementing reserved quantities on indent rows.\nWhen an order is created against a Comparative Statement, CS booking balances are updated.\nAuthorization triggers status transitions in source indent lines from Open to Consumed.\nCancelling an order line invokes balance restoration procedures returning quantities to indents.\nDetail replacement executes within a database transaction to prevent orphan records upon execution failure.\nAudit logging records prior states to historical tracking tables before row regeneration.\nForeign key constraints enforce referential integrity against item and vendor masters.\nCascade handlers ensure inventory demand staging tables reflect current net requirements accurately.\nLine item replacement commits synchronously with document header updates within a single transaction.\nThis mutation logic guarantees that parent document balances stay synchronized with child purchase orders.",
        source_refs: ["rule:detail-replacement-on-save", "rule:atomic-save", "concept:purchase-order"]
      },
      {
        level: "hard",
        topic_key: "authorization-matrix-and-state-machine",
        title: "Authorization group schema, multi-level approvals, and state locks",
        body: "fPurchaseOrder implements a state machine governed by masterdata.mAuthorizationGroup tables.\nAuthorization groups define approval hierarchies stored in masterdata.mAuthorizationGroupUser.\nIntermediate approvals insert audit records into Purchase.PMPOApprovalHistory.\nIntermediate sign-offs maintain DocumentStatus as Release without granting final authorization.\nOnly users mapped to the terminal hierarchy level can transition status to Authorized.\nDirect status updates to Authorized bypass approval procedures and are blocked by server triggers.\nAuthorized records become read-only at database level via update-prevention triggers.\nDocument amendments create linked records in Purchase.PMPOAmendment maintaining revision IDs.\nState transitions dispatch notification emails through system background queue tables.\nAudit history logs capture approver user IDs, approval decisions, comments, and action timestamps.\nState transitions execute within serialized transactions to prevent concurrent conflicting authorizations.\nThis approval framework enforces strict regulatory compliance and financial segregation of duties.",
        source_refs: ["rule:material-receipt-note-multi-level-authorization", "rule:authorized-document-lock"]
      },
      {
        level: "hard",
        topic_key: "referential-integrity-and-deletion-guards",
        title: "Referential integrity constraints and backend deletion barriers",
        body: "Backend deletion procedures evaluate foreign key dependencies across operational schemas.\nPurchase.PMPODelete queries Inventory.IGRNMain to detect linked material receipt notes in stores.\nThe presence of linked Gate Entry or GRN records triggers foreign key dependency errors.\nQueries against Finance.fAdvanceRequest block deletion if advance vouchers reference the PO ID.\nActive bank guarantees in Finance.fBankGuarantee create blocking integrity constraints.\nExisting revision rows in Purchase.PMPOAmendment prevent deletion of the parent order.\nDeletion handlers execute within explicit transaction blocks with rollback on violation.\nAudit tables capture deletion attempts, user credentials, and machine IP addresses.\nSoft-delete flags are set on specific line items when balances are closed manually by buyers.\nHard deletes are permitted only on unreferenced Initial status drafts by authorized users.\nReferential integrity barriers protect historical procurement data from accidental administrative deletion.\nDatabase triggers ensure child records in freight and expense tables purge synchronously on draft removal.",
        source_refs: ["method_notes", "validations", "rule:atomic-save"]
      }
    ]
  },
  {
    scope: "form",
    key: "fGRN",
    title: "Material Receipt Note (GRN)",
    context: "Material Management › Procure-to-Pay (PO Flow) › Material Receipt Note (GRN)",
    module: "MM",
    audience: "functional",
    cards: [
      {
        level: "hard",
        topic_key: "place-in-procurement-and-quality-flows",
        title: "Where the Material Receipt Note sits in procurement and inventory flows",
        body: "The Material Receipt Note represents step ten in Procure-to-Pay and step eight in Goods Receipt.\nIt immediately follows the Gate Entry where arriving delivery vehicles are logged by security.\nWarehouse storekeepers use this document to officially receive physical stock into company facilities.\nIt serves as the concluding transaction of procurement and the entry point for warehouse stores.\nAccepted materials become usable stock, while rejected items are isolated for return to vendor.\nThe document closes open purchase orders, indents, and inter-unit transfer challans.\nSimultaneously, it generates a valued inward record that feeds the Finance payment flow.\nIf the item requires inspection, the receipt triggers the quality inspection intimation.\nA gate entry linked to another receipt cannot be reused, preventing duplicate stores receipts.\nPhysical verification against this document ensures company stock matches actual deliveries.\nAuthorizing the receipt note is the exact operational trigger that increments warehouse stock ledgers.\nWithout this verified document, accounts payable cannot match supplier bills for payment.",
        source_refs: ["summary", "purpose", "process:procure-to-pay", "process:goods-receipt-quality-inspection", "used_by"]
      },
      {
        level: "hard",
        topic_key: "mandatory-receipt-headers-and-references",
        title: "Mandatory receipt header details, vendor bills, and date validations",
        body: "Creating a receipt note requires critical commercial headers and source document selections.\nThe user must specify a document type, reference document source, vendor, and verified location.\nThe supplier bill number and bill date are compulsory to support downstream payment matching.\nA freight type must be selected for all direct receipts and multi-party delivery notes.\nSupplier bill dates, challan dates, and transport receipt dates cannot be in the future.\nIf the vendor bill date is later than the receipt document date, the save is blocked.\nDriver and vehicle information must conform to formatting rules when company checks are active.\nDuplicate receipt numbers are barred by automated yearly document numbering routines.\nDivision mapping rules require the finance book to be linked to the active operational unit.\nMissing mandatory headers halt saving and highlight the exact field requiring attention.\nVehicle details and transport waybill dates ensure full statutory compliance for logistics audits.\nAccurate recording of supplier bill details prevents billing disputes during financial voucher passing.",
        source_refs: ["fields", "messages", "rule:mandatory-document-fields", "rule:document-numbering"]
      },
      {
        level: "hard",
        topic_key: "quantity-tolerance-and-accepted-calculations",
        title: "Accepted quantity formulas, tolerance boundaries, and rate adjustments",
        body: "Line item quantities follow strict mathematical formulas to maintain inventory accuracy.\nAccepted quantity is calculated as received quantity minus rejected and free quantities.\nThe total line value equals the accepted quantity multiplied by the agreed unit rate.\nReceived quantities must remain within the positive tolerance allowed by the purchase order.\nIf accepted quantity exceeds the open balance plus tolerance, the save is rejected.\nFor raw materials where challan quantities are passed on, unit rates are recalculated.\nThe adjusted rate equals challan quantity multiplied by rate, divided by accepted quantity.\nConversion factors between purchasing units and inventory units must be positive and non-zero.\nEvery line item must identify an active warehouse location where stock will be deposited.\nThese mathematical checks protect the organization against over-billing and stock discrepancies.\nBatch tracking details and expiry dates are mandatory for items marked for shelf-life control.\nTolerance rules prevent suppliers from dispatching excess unordered stock into company stores.",
        source_refs: ["rule:material-receipt-note-automatic-calculations", "rule:receipt-tolerance", "messages"]
      },
      {
        level: "hard",
        topic_key: "multi-reference-consistency-and-currency-rules",
        title: "Reference combination integrity and currency consistency rules",
        body: "A single receipt note can combine multiple source references under strict conditions.\nAll combined purchase orders or gate passes must share the same operational source type.\nCombined references must use identical transaction currencies and compatible exchange rates.\nMixing references with conflicting currencies causes the system to stop the transaction.\nOnly a single inter-unit dispatch challan can be linked to any individual receipt note.\nGate entries already consumed by an existing receipt cannot be selected a second time.\nDocument dates cannot precede historical cutoff dates established by system configuration.\nTax schedules and consignee locations must align across all selected reference documents.\nThese consistency rules prevent mismatched financial postings and entangled document lineage.\nUsers must ensure reference uniformity before allocating received quantities across line items.\nDiscrepancies in currency or exchange rates halt saving until references are reconciled.\nUniform reference selection ensures clean three-way matching during accounts payable processing.",
        source_refs: ["rule:material-receipt-note-reference-selection-consistency", "messages"]
      },
      {
        level: "hard",
        topic_key: "quality-inspection-and-rejected-goods-handling",
        title: "Inspection workflow integration and return of rejected materials",
        body: "Items flagged for mandatory inspection require formal quality verification before acceptance.\nThe system stops final authorization if an inspection intimation remains unresolved.\nStorekeepers cannot complete receipts while technical inspection tests are pending.\nRejected quantities entered on receipt lines cannot exceed quantities rejected by inspection.\nWhen rejected stock exists, the system enables return processing via dispatch challans.\nAuthorizing receipts with rejected items without creating return challans triggers warnings.\nRejected items remain isolated from usable inventory to prevent accidental operational use.\nBin card tracking requires physical storage locations for inspected stock before release.\nInspection integration ensures that substandard materials are never accepted into company stock.\nFinal stock authorization occurs only after quality personnel approve the delivered goods.\nReturned materials generate formal debit notes to recover costs from the supplying vendor.\nThis quality control safeguard guarantees that only certified raw materials enter production.",
        source_refs: ["rule:material-receipt-note-inspection", "rule:material-receipt-note-return-through-dispatch-challan", "messages"]
      },
      {
        level: "hard",
        topic_key: "authorization-lifecycle-and-stock-posting",
        title: "Document lifecycle progression, record locking, and stock posting",
        body: "Receipt notes advance through three formal operational statuses: Initial, Release, and Authorized.\nSaving in Release status records the releaser identity and prepares the record for review.\nUnder multi-tier authorization, only the terminal approver can transition status to Authorized.\nAttempting premature authorization produces error notifications stopping the save operation.\nFinal authorization is the precise event that posts physical stock into warehouse ledgers.\nIf the current inventory accounting month is locked, authorization is strictly prohibited.\nOnce authorized, the receipt note is locked against editing, number modification, or deletion.\nHeader and detail lines save atomically, ensuring partial updates never compromise data integrity.\nEditing un-authorized receipts clears existing lines and regenerates them from current inputs.\nLocked document status guarantees that historical inventory additions remain fully auditable.\nAuthorized receipts write permanent financial staging records consumed by purchase invoice booking.\nThis state progression guarantees strict segregation of duties between receiving clerks and supervisors.",
        source_refs: ["rule:material-receipt-note-status-mapping-and-audit", "rule:authorized-document-lock", "messages"]
      },
      {
        level: "hard",
        topic_key: "indent-allocation-and-status-cascades",
        title: "Indent allocations, reservation balances, and status cascades",
        body: "Receipt quantities must reconcile exactly against original departmental requisitions.\nWhen receipts satisfy specific indents, the sum of indent allocations must equal accepted quantity.\nFor reserved indents, allocation amounts cannot exceed the open reserved balance.\nWhen batch tracking or serial numbers are active, details must equal total received units.\nAuthorizing the receipt note automatically triggers status cascades across upstream documents.\nLinked purchase orders, gate passes, and indents have their open balances decremented.\nOrders with zero remaining balance are automatically updated to completed status.\nFinance receives valued inward transaction records ready for purchase bill matching.\nEditing an un-authorized receipt resets linked document balances before recalculating them.\nThese cascades keep inventory balances, procurement orders, and requisitions synchronized.\nReconciled allocations ensure that departmental requisition lines close accurately upon receipt.\nAutomated status cascades eliminate manual tracking of outstanding purchase order commitments.",
        source_refs: ["rule:material-receipt-note-indent-allocation", "rule:material-receipt-note-source-status-cascade", "messages"]
      }
    ]
  },
  {
    scope: "form",
    key: "fGRN",
    title: "Material Receipt Note (GRN)",
    context: "Material Management › Procure-to-Pay (PO Flow) › Material Receipt Note (GRN)",
    module: "MM",
    audience: "technical",
    cards: [
      {
        level: "hard",
        topic_key: "schema-bindings-and-data-structures",
        title: "Database schema architecture, entity bindings, and keys of fGRN",
        body: "fGRN is a mission-critical inventory transaction form operating in the MM module.\nHeader attributes persist in Inventory.IGRNMain with primary key DocNo and DocumentYearlyNo.\nLine items map to Inventory.IGRNDetail capturing ItemId, AcceptedQty, RejectedQty, and Rate.\nAssociated batch and serial details write to Inventory.IGRNBatchDetail and IGRNSerialDetail.\nTax distributions are recorded in the centralized table Finance.TDCTransactionDetail.\nWarehouse bin allocations write to Inventory.IBINCardDetail linked by GRNDetailId.\nEntity state transitions follow DocumentStatus flags Initial, Release, and Authorized.\nModifiedDate and ModifiedBy columns enforce optimistic concurrency during concurrent edits.\nShared custom field values persist via masterdata.customfieldssave during transaction commit.\nAll child tables maintain foreign key integrity referencing the parent document header.\nAudit trail triggers capture record modification history in Inventory.IGRNAuditDetail.\nTransaction commits execute within serialized isolation levels to maintain inventory integrity.",
        source_refs: ["method_notes", "summary", "concept:goods-receipt-note"]
      },
      {
        level: "hard",
        topic_key: "stored-procedures-and-method-routines",
        title: "Stored procedure bindings for search, load, save, and delete in fGRN",
        body: "Data operations on fGRN execute through specialized inventory stored procedures in the database.\nSearch queries invoke Inventory.IGRNSearchData to return filtered receipt header records.\nRecord loading executes through Inventory.IGRNLoadData and Inventory.IGRNItemIndentDetail.\nTransaction persistence is orchestrated by the master save routine sp inventory.igrnsave.\nValidation rules execute server-side via Inventory.IGRNCustomValidation before data writing.\nRecord removal is governed by Inventory.IGRNDelete which validates downstream references.\nLookup values and dependent filters populate using Inventory.IGRNFillValues procedures.\nVendor profile parameters load through GlobalData.VendorLocationSelect lookup procedures.\nStock valuation and finance voucher generation invoke Inventory.IGRNFinancePosting.\nStructured error codes returned by procedures are translated into UI notifications.\nAll procedures execute within explicit transaction blocks with rollback on error.\nDiagnostic shortcuts Ctrl+Alt+G copy database update scripts to the clipboard for review.",
        source_refs: ["method_notes", "rule:atomic-save"]
      },
      {
        level: "hard",
        topic_key: "validation-triggers-and-rejection-conditions",
        title: "Backend validation triggers and error conditions enforced by fGRN",
        body: "fGRN enforces rigorous data integrity constraints prior to executing persistence routines in the database.\nAcceptedQty > (BalancePOQty + ToleranceQty) fires an immediate validation exception on save.\nSelecting a GateEntryNo already bound to an active IGRNMain record triggers duplicate errors.\nMismatched currencies across multiple selected PO references aborts the save operation.\nChallanDate > DocumentDate or VendorBillDate > DocumentDate triggers date validation refusal.\nDocumentStatus == Authorized halts save attempts with Authorized Entry can't be updated.\nDivision month-lock flags in masterdata.mDivision lock tables prevent transaction authorization.\nMissing warehouse selections on detail rows abort processing when warehouse flags are active.\nNegative or zero conversion factors on dual-unit items trigger conversion calculation errors.\nValidation routines execute within client pre-checks and server validation procedures.\nInspection pending flags block authorization when quality inspection checks are mandated.\nStructured error messages identify the exact line item and column violating business constraints.",
        source_refs: ["validations", "rule:receipt-tolerance", "rule:material-receipt-note-gate-entry-single-use"]
      },
      {
        level: "hard",
        topic_key: "detail-replacement-and-atomic-save",
        title: "Detail line replacement architecture and atomic transaction boundaries",
        body: "Editing existing fGRN documents utilizes a detail replacement mutation pattern in the database.\nExisting child rows in Inventory.IGRNDetail and related tables are purged within the transaction.\nCurrent screen state lines are inserted anew, generating sequential DetailRowId values.\nAtomic transaction boundaries ensure header updates and child re-insertions commit together.\nIf any validation rule or database trigger fails, the entire transaction rolls back.\nCascade handlers first revert upstream PO and indent consumed balances to prior states.\nThe newly inserted lines then apply updated consumption quantities to parent records.\nAudit log triggers capture deleted rows into historical archive tables prior to replacement.\nConcurrency timestamps prevent detail replacement if another user modified the document.\nThis pattern guarantees that inventory balances never drift due to partial data commits.\nDetail line replacement executes synchronously with parent document updates.\nForeign key constraints ensure orphaned child rows cannot persist after update execution.",
        source_refs: ["rule:detail-replacement-on-save", "rule:atomic-save", "concept:goods-receipt-note"]
      },
      {
        level: "hard",
        topic_key: "stock-ledger-posting-and-financial-integration",
        title: "Stock ledger mutation and financial voucher interface upon authorization",
        body: "Document authorization executes dual-ledger posting via Inventory.IGRNFinancePosting in the database.\nPhysical on-hand inventory increments within Inventory.IStockLedger for accepted item lines.\nValued inward entries evaluate item valuation methods FIFO, Weighted Average, or Standard.\nConcurrently, Account Determination Rules (ARD) resolve inventory asset and clearing accounts.\nStaging tables in the Finance schema receive valued lines to support Purchase Bill matching.\nIf inspection rejected quantities exist, quarantine stock ledgers isolate the material.\nDatabase triggers prevent stock postings if inventory periods are closed for the division.\nVoucher IDs generated in Finance write back to IGRNMain to establish audit lineage.\nRollback handlers reverse stock additions if financial staging generation encounters errors.\nFinancial postings maintain double-entry balancing invariants between inventory and clearing ledgers.\nStock ledger updates capture batch IDs, serial numbers, and physical warehouse bin assignments.\nThis posting interface ensures exact synchronization between physical inventory and the General Ledger.",
        source_refs: ["rule:material-receipt-note-stock-posting-on-authorization", "rule:finance-posting-from-transactions"]
      },
      {
        level: "hard",
        topic_key: "concurrency-controls-and-referential-guards",
        title: "Concurrency controls, optimistic locking, and referential barriers",
        body: "fGRN enforces optimistic concurrency to maintain consistency in multi-user environments.\nWhen saving, the procedure compares the client ModifiedDate with the database record timestamp.\nIf another session modified the receipt, the server returns Someone updated this record.\nReferential integrity barriers prevent document deletion once downstream processes engage.\nIf a Purchase Bill in Finance.fPurchaseBill references the GRN DocNo, deletion is blocked.\nIf quality inspection entries exist in Inventory.IInspectionEntry, removal is disallowed.\nAuthorized receipts cannot be deleted or un-authorized through standard application interfaces.\nLine cancellation routines must be utilized to process return dispatch challans for rejected goods.\nSecurity audit tables log all authorization, update, and deletion attempts with user session data.\nDatabase triggers enforce referential barriers across Purchase, Inventory, and Finance schemas.\nOptimistic locking prevents lost updates during simultaneous warehouse intake processing.\nAudit trails preserve complete historical snapshots of receipts for statutory compliance.",
        source_refs: ["method_notes", "validations", "rule:authorized-document-lock"]
      }
    ]
  }
];
