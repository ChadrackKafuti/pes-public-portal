// JSX typings for the ArcGIS map components and Calcite custom elements (React 19 native custom-element support).
/// <reference types="@arcgis/map-components/types/react" />
/// <reference types="@esri/calcite-components/types/react" />

declare module "*.arcade?raw" {
  const content: string;
  export default content;
}
