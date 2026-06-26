import { runSubstrateConformance } from "../src/conformance.js";
import { createMemorySubstrate } from "../src/memory.js";

runSubstrateConformance(async () => createMemorySubstrate());
