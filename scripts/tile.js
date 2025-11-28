import { isometricModuleConfig } from './consts.js';
import { applyIsometricTransformation } from './transform.js';

function patchTileConfigClass(ConfigClass) {
  if (!ConfigClass) return;

  // Avoid double-patching, check own property to avoid inheritance issues
  if (Object.prototype.hasOwnProperty.call(ConfigClass, '_isometricPatched')) return;

  console.log("Isometric Perspective | Patching TileConfig class:", ConfigClass.name);

  const label = game.i18n.localize("isometric-perspective.tab_isometric_name");
  const tabGroup = "sheet";
  const tabId = "isometric";
  const icon = "fas fa-cube";
  const isoTemplatePath = 'modules/isometric-perspective/templates/tile-config.hbs';

  // 1. Patch TABS
  const tabsDescriptor = Object.getOwnPropertyDescriptor(ConfigClass, 'TABS');
  if (tabsDescriptor && (tabsDescriptor.get || !tabsDescriptor.writable)) {
    Object.defineProperty(ConfigClass, 'TABS', {
      get: function() {
        const tabs = tabsDescriptor.get ? tabsDescriptor.get.call(this) : tabsDescriptor.value;
        if (tabs?.sheet?.tabs && !tabs.sheet.tabs.some(t => t.id === tabId)) {
          tabs.sheet.tabs.push({ id: tabId, group: tabGroup, label, icon: icon });
        }
        return tabs;
      },
      configurable: true
    });
  } else if (ConfigClass.TABS?.sheet?.tabs) {
    if (!ConfigClass.TABS.sheet.tabs.some(t => t.id === tabId)) {
      ConfigClass.TABS.sheet.tabs.push({ id: tabId, group: tabGroup, label, icon: icon });
    }
  }

  // 2. Patch PARTS
  const partsDescriptor = Object.getOwnPropertyDescriptor(ConfigClass, 'PARTS');
  if (partsDescriptor && (partsDescriptor.get || !partsDescriptor.writable)) {
    Object.defineProperty(ConfigClass, 'PARTS', {
      get: function() {
        const parts = partsDescriptor.get ? partsDescriptor.get.call(this) : partsDescriptor.value;
        if (!parts.isometric) {
          parts.isometric = { template: isoTemplatePath };
          if (parts.footer) {
            const footer = parts.footer;
            delete parts.footer;
            parts.footer = footer;
          }
        }
        return parts;
      },
      configurable: true
    });
  } else if (ConfigClass.PARTS) {
    ConfigClass.PARTS.isometric = { template: isoTemplatePath };
    if (ConfigClass.PARTS.footer) {
      const footer = ConfigClass.PARTS.footer;
      delete ConfigClass.PARTS.footer;
      ConfigClass.PARTS.footer = footer;
    }
  }

  // 3. Override _preparePartContext
  const originalPreparePartContext = ConfigClass.prototype._preparePartContext;
  ConfigClass.prototype._preparePartContext = async function(partId, context, options) {
    if (partId === "isometric") {
      const flags = this.document.flags[isometricModuleConfig.MODULE_ID] ?? null;
      return {
        ...(flags ?? {}),
        document: this.document,
        tab: context.tabs[partId],
      };
    }
    return originalPreparePartContext.call(this, partId, context, options);
  };

  ConfigClass._isometricPatched = true;
}

export function hookTileConfigManager() {
  if (!CONFIG.Tile?.sheetClasses?.base) return;

  const base = CONFIG.Tile.sheetClasses.base;
  const configKey = 'core.TileConfig';
  const config = base[configKey];

  if (!config) return;

  let _cls = config.cls;
  if (_cls) patchTileConfigClass(_cls);

  Object.defineProperty(config, 'cls', {
    get: function() {
      return _cls;
    },
    set: function(newCls) {
      patchTileConfigClass(newCls);
      _cls = newCls;
    },
    configurable: true,
    enumerable: true
  });
}

export async function handleRenderTileConfig(app, html, data) {
  if (app && app.constructor) {
    patchTileConfigClass(app.constructor);
  }
}

export function addLinkedWallsListeners(app, html, context, options){
  const selectWallButton = html.querySelector('.select-wall');
  const clearWallButton = html.querySelector('.clear-wall');
  const linkedWallsIdInput = html.querySelector('input[name="flags.isometric-perspective.linkedWallIds"]');

  if (selectWallButton) selectWallButton.addEventListener('click', selectWall);
  if (clearWallButton) clearWallButton.addEventListener('click', clearWall);

  const FoundryTileConfig = foundry.applications.sheets.TileConfig;
  const DefaultTileConfig = Object.values(CONFIG.Tile.sheetClasses.base).find((d) => d.default)?.cls;
  const TileConfig = DefaultTileConfig?.prototype instanceof FoundryTileConfig ? DefaultTileConfig : FoundryTileConfig;

  function selectWall(event) {    
    Object.values(ui.windows).filter(w => w instanceof TileConfig).forEach(j => j.minimize());
    canvas.walls.activate();

    Hooks.once('controlWall', async (wall) => {
      const selectedWallId = wall.id.toString();
      const currentWallIds = app.document.getFlag(isometricModuleConfig.MODULE_ID, 'linkedWallIds') || [];
      
      if (!currentWallIds.includes(selectedWallId)) {
        const newWallIds = [...currentWallIds, selectedWallId];
        await app.document.setFlag(isometricModuleConfig.MODULE_ID, 'linkedWallIds', newWallIds);
        const linkedWallId = html.querySelector('input[name="flags.isometric-perspective.linkedWallIds"]').value;
      }

      Object.values(ui.windows).filter(w => w instanceof TileConfig).forEach(j => j.maximize());
      canvas.tiles.activate();
    });
  }

  async function clearWall () {
    console.log("CLEARING WALLS:");
    await app.document.setFlag(isometricModuleConfig.MODULE_ID, 'linkedWallIds', []);
    if (linkedWallsIdInput) linkedWallsIdInput.value = '';
  }
}

export function handleCreateTile(tileDocument) {
  const tile = canvas.tiles.get(tileDocument.id);
  if (!tile) return;
  const scene = tile.scene;
  const isSceneIsometric = scene.getFlag(isometricModuleConfig.MODULE_ID, "isometricEnabled");
  requestAnimationFrame(() => applyIsometricTransformation(tile, isSceneIsometric));
}

export function handleUpdateTile(tileDocument, updateData, options, userId) {
  const tile = canvas.tiles.get(tileDocument.id);
  if (!tile) return;
  
  const scene = tile.scene;
  const isSceneIsometric = scene.getFlag(isometricModuleConfig.MODULE_ID, "isometricEnabled");
  
  if (updateData.x !== undefined ||
      updateData.y !== undefined ||
      updateData.width !== undefined ||
      updateData.height !== undefined ||
      updateData.texture !== undefined) {
    requestAnimationFrame(() => applyIsometricTransformation(tile, isSceneIsometric));
  }
}

export function handleRefreshTile(tile) {
  const scene = tile.scene;
  const isSceneIsometric = scene.getFlag(isometricModuleConfig.MODULE_ID, "isometricEnabled");
  applyIsometricTransformation(tile, isSceneIsometric);
}
  
function updateAdjustOffsetButton(html) {
  const offsetPointContainer = html.querySelector('.offset-point')?.[0] || html.querySelector('.offset-point');
  if (!offsetPointContainer) return;

  const adjustButton = offsetPointContainer.querySelector('button.fine-adjust');
  if (!adjustButton) return;

  adjustButton.style.width = '30px';
  adjustButton.style.cursor = 'pointer';
  adjustButton.style.padding = '1px 5px';
  adjustButton.style.border = '1px solid #888';
  adjustButton.style.borderRadius = '3px';
  adjustButton.title = game.i18n.localize('isometric-perspective.tile_artOffset_mouseover');

  let isAdjusting = false;
  let startX = 0;
  let startY = 0;
  let originalValueX = 0;
  let originalValueY = 0;

  let offsetXInput = html.querySelector('input[name="flags.isometric-perspective.offsetX"]');
  let offsetYInput = html.querySelector('input[name="flags.isometric-perspective.offsetY"]');

  if (!offsetXInput || !offsetYInput) return;

    const applyAdjustment = (e) => {
      if (!isAdjusting) return;

      const deltaY = e.clientX - startX;
      const deltaX = startY - e.clientY;
      
      const adjustmentX = deltaX * 0.1;
      const adjustmentY = deltaY * 0.1;
      
      let newValueX = Math.round(originalValueX + adjustmentX);
      let newValueY = Math.round(originalValueY + adjustmentY);
      
      newValueX = Math.round(newValueX * 100) / 100;
      newValueY = Math.round(newValueY * 100) / 100;
      
      offsetXInput.value = newValueX.toFixed(0);
      offsetYInput.value = newValueY.toFixed(0);
      offsetXInput.dispatchEvent(new Event('change', { bubbles: true }));
      offsetYInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    adjustButton.addEventListener('mousedown', (e) => {
      isAdjusting = true;
      startX = e.clientX;
      startY = e.clientY;
      
      originalValueX = parseFloat(offsetXInput.value);
      originalValueY = parseFloat(offsetYInput.value);
    
      document.addEventListener('mousemove', applyAdjustment);
      document.addEventListener('mouseup', () => {
        isAdjusting = false;
        document.removeEventListener('mousemove', applyAdjustment);
      });
    
      e.preventDefault();
    });
  }
