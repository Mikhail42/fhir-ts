/**
 * Code generation from FHIR StructureDefinitions
 */

import { readFileSync } from "fs";
import * as glob from "glob";
import { format } from "prettier";

import {
  ElementDefinition,
  ElementGroup,
  StructureDefinition
} from "./conformance";
import {
  elementName,
  generateInterfaces,
  getElementGroups,
  getImports,
  typeDeclaration,
  wrapRecursive,
  writeFileAsync
} from "./helpers";

interface File {
  name: string;
  code: string;
}

export class Generator {
  public configuration = {
    barrel: true,
    fromDifferential: true,
    singleFile: false
  };

  constructor(private input: string, private outputPath: string) {}

  /**
   * Reads input StructureDefinitions, generates code,
   * and writes to output directory.
   */
  public async run() {
    const files = this.readInput(this.input);
    const structureDefinitions = files.map(this.parseDefinition);
    const code = this.generate(structureDefinitions);
    this.write(code);
  }

  /**
   * Read files from input glob pattern
   */
  private readInput = (input: string) => {
    const cwd = process.cwd();
    return glob.sync(`${cwd}/${input}`).map(fileName => {
      return readFileSync(fileName).toString();
    });
  };

  /**
   * Parse the input JSON string to StructureDefinition object
   */
  private parseDefinition = (file: string): StructureDefinition =>
    JSON.parse(file);

  /**
   * Generates code from StructureDefinitions based on configuration
   */
  private generate = (structureDefinitions: StructureDefinition[]): File[] => {
    const code = structureDefinitions.map(this.renderModule);
    if (this.configuration.barrel) {
      return [...code, this.generateBarrel(structureDefinitions)];
    }
    return code;
  };

  /**
   * Write generated code to output directory
   */
  private write = (files: File[]): Promise<void[]> =>
    Promise.all(
      files.map(({ name, code }) =>
        writeFileAsync(`${this.outputPath}/${name}.ts`, code)
      )
    );

  /**
   * Generates module code for a StructureDefinition
   */
  private renderModule = (structureDefinition: StructureDefinition): File => {
    const { name, snapshot, type } = structureDefinition;
    // TODO: Support from Differential
    const elementDefinitions = snapshot!.element || [];

    const elementGroups = getElementGroups(name, type, elementDefinitions);

    const imports = this.configuration.singleFile
      ? ""
      : `${getImports(
          type,
          elementDefinitions.filter(element => element.path !== type) // Filter out root ElementDefinition
        ).join("\n")}`;

    const typeDeclarations = elementGroups.map(this.generateType).join("\n\n");

    const code = format(
      `
      /**
       * ${name} Module
       */
      import * as primitives from "@tangdrew/primitives";
      import * as t from "io-ts";

      ${imports}

      ${typeDeclarations}
      `,
      { parser: "typescript" }
    );

    return {
      code,
      name
    };
  };

  /**
   * Generates io-ts type code from list of ElementDefinitions
   */
  private generateType = (elementGroup: ElementGroup): string => {
    const { comment, definitions, name } = elementGroup;
    const [required, optional] = this.categorizeElementDefinitions(definitions);
    const requiredProperties = this.getProperties(required);
    const optionalProperties = this.getProperties(optional);

    const runType = `t.intersection([
        t.type({
          ${requiredProperties.join(",\n")}
        }),
        t.partial({
          ${optionalProperties.join(",\n")}
        })
      ], "${name}")`;

    return `/**
    * ${comment}
    */
    ${generateInterfaces(elementGroup)}

    ${wrapRecursive(name, runType)}`;
  };

  /**
   * Categorizes element definitions into required and optional
   */
  private categorizeElementDefinitions = (
    elementDefinitions: ElementDefinition[]
  ): [ElementDefinition[], ElementDefinition[]] => {
    return elementDefinitions.reduce<
      [ElementDefinition[], ElementDefinition[]]
    >(
      (accum, curr) => {
        const [required, optional] = accum;
        const { min } = curr;
        const isRequired = min! > 0;
        if (isRequired) {
          return [[...required, curr], optional];
        }
        return [required, [...optional, curr]];
      },
      [[], []]
    );
  };

  /**
   * Parses StructureDefinition into sorted io-ts property definitions
   */
  private getProperties = (
    elementDefinitions: ElementDefinition[]
  ): string[] => {
    return elementDefinitions
      .sort((a, b) => (elementName(a) > elementName(b) ? 1 : -1))
      .map(element => {
        const { path, short } = element;
        const propertyName = elementName(element);
        const typeName = typeDeclaration(element);
        if (!typeName) {
          throw new Error(`Expected a type for element ${path}.`);
        }
        return `/** ${short} */
        ${propertyName}: ${typeName}`;
      });
  };

  /**
   * Generates TypeScript barrel code for the module
   */
  private generateBarrel = (
    structureDefinitions: StructureDefinition[]
  ): File => {
    const code = structureDefinitions
      .map(({ name }) => `export { ${name} } from "./${name}";`)
      .join("\n");
    return {
      code,
      name: "index"
    };
  };
}
