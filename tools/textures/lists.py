# (kind) -> ids ; hero ids get 2K
ACG = {
 'stone_ashlar': 'Bricks076A Bricks064 Bricks066 Bricks068 Bricks038 Bricks008 Granite001A Granite002A Granite005A',
 'stone_rubble': 'Bricks102 Bricks078 Bricks089 Bricks018 Bricks083 Bricks084 Bricks091 Bricks076C Rocks001 Rocks011 Rocks008',
 'stone_flag': 'Bricks075A Bricks075B PavingStones054 PavingStones069',
 'brick': 'Bricks003 Bricks005 Bricks006 Bricks007 Bricks012 Bricks016 Bricks022 Bricks023 Bricks025 Bricks026 Bricks037 Bricks050 Bricks054 Bricks059 Bricks060 Bricks085 Bricks086 Bricks090 Bricks094 Bricks097 Bricks077 Bricks053 Bricks058 Bricks035 PaintedBricks003 PaintedBricks004',
 'asphalt': 'Asphalt010 Asphalt011 Asphalt012 Asphalt013 Asphalt016 Asphalt017 Asphalt018 Asphalt019 Asphalt021 Asphalt022 Asphalt023S Asphalt024A Asphalt025B Asphalt026C Asphalt027C Asphalt033',
 'cobble': 'PavingStones033 PavingStones041 PavingStones046 PavingStones047 PavingStones049 PavingStones051 PavingStones057 PavingStones067 PavingStones070 PavingStones116 PavingStones119 PavingStones131 PavingStones138 PavingStones142 PavingStones150 PavingStones025 PavingStones083 PavingStones087 PavingStones107',
 'paving': 'PavingStones035 PavingStones036 PavingStones038 PavingStones092 PavingStones099 PavingStones105 PavingStones108 PavingStones109 PavingStones114 PavingStones122 PavingStones125A PavingStones126A PavingStones127 PavingStones128 PavingStones129 PavingStones081 PavingStones078',
 'concrete': 'Concrete002 Concrete012 Concrete016 Concrete019 Concrete020 Concrete024 Concrete034 Concrete036 Concrete040 Concrete046 Concrete047A Concrete048 Concrete035 Concrete032 Concrete044C',
 'plaster': 'Plaster001 Plaster002 Plaster003 Plaster004 Plaster005 Plaster006 Plaster007 PaintedPlaster004 PaintedPlaster006 PaintedPlaster007 PaintedPlaster008 PaintedPlaster009 PaintedPlaster010 PaintedPlaster011 PaintedPlaster012 PaintedPlaster014 PaintedPlaster015 PaintedPlaster016 PaintedPlaster017 PaintedPlaster018',
 'roof_slate': 'RoofingTiles001 RoofingTiles002 RoofingTiles003 RoofingTiles004 RoofingTiles005 RoofingTiles009 RoofingTiles013A RoofingTiles013B RoofingTiles015A RoofingTiles015B',
 'roof_tile': 'RoofingTiles006 RoofingTiles007 RoofingTiles011A RoofingTiles012A RoofingTiles014A',
 'metal': 'Metal005 Metal017 Metal019 Metal021 Metal022 Metal024 Metal025 Metal027 Metal028 Metal030 Metal036 Metal038 Metal046A Metal046B Metal047B Metal007 Metal035 PaintedMetal004 PaintedMetal006 Rust002 Rust004',
 'wood': 'Planks007 Planks011 Planks012 Planks013 Planks014 Planks015 Planks016 Planks021 Planks023A Planks023B WoodSiding003 WoodSiding004 WoodSiding006 WoodSiding010 WoodSiding011 WoodSiding012 WoodSiding013 PaintedWood001 PaintedWood003 PaintedWood005 PaintedWood006A PaintedWood006B PaintedWood007A PaintedWood007B PaintedWood008A PaintedWood008B PaintedWood009A PaintedWood009B PaintedWood009C Wood060 Wood061 Wood062',
 'gravel': 'Gravel001 Gravel004 Gravel010 Gravel011 Gravel013 Gravel020 Gravel022 Gravel028 Gravel030 Gravel032 Gravel033 Gravel035 Gravel040 Gravel043',
 'ground': 'Ground015 Ground022 Ground023 Ground024 Ground031 Ground032 Ground036 Ground038 Ground048 Ground051 Ground053 Ground062S Ground067 Ground071 Ground079S Ground103 Ground003 Ground013 Ground047 Ground085 Ground026 Ground049A',
 'grass': 'Grass001 Grass002 Grass003 Grass004 Grass005 Grass007 Grass008',
 'moss': 'Moss001 Moss002 Moss003 Moss004',
 'snow': 'Snow001 Snow002 Snow003 Snow004 Snow005 Snow006 Snow008A Snow010A Snow014 Snow015',
 'rock_cliff': 'Rock003 Rock005 Rock007 Rock011 Rock012 Rock013 Rock014 Rock016 Rock022 Rock023 Rock028 Rock030 Rock031 Rock032 Rock034 Rock041 Rock045 Rock048 Rock050 Rock051 Rock058 Rock060 Rock061 Rock063 Rock064',
}
ACG_HERO = set('Bricks076A Bricks102 Bricks003 Bricks059 PavingStones041 PavingStones070 Asphalt023S Asphalt012'.split())
PH = {
 'stone_ashlar': 'medieval_blocks_02 medieval_blocks_03 medieval_blocks_05 medieval_blocks_06 castle_brick_07 castle_wall_varriation large_sandstone_blocks stone_block_wall white_sandstone_blocks_02 granite_wall',
 'stone_rubble': 'old_stone_wall old_stone_wall_02 castle_wall_slates mossy_stone_wall rustic_stone_wall stone_wall stone_wall_02 stone_wall_04 stacked_stone_wall plastered_stone_wall yellow_stone_wall rough_block_wall stone_brick_wall_001 rock_wall_08',
 'brick': 'brick_wall_001 brick_wall_003 brick_wall_006 brick_wall_02 brick_wall_07 brick_wall_09 brick_wall_10 brick_wall_12 red_brick red_brick_03 church_bricks_02 mixed_brick_wall painted_brick painted_worn_brick whitewashed_brick worn_brick_wall yellow_brick medieval_red_brick slumped_mortar_brick red_brick_plaster_patch_02 castle_brick_02_red white_bricks large_red_bricks',
 'cobble': 'cobblestone_floor_01 cobblestone_floor_02 cobblestone_floor_03 cobblestone_floor_04 cobblestone_floor_05 cobblestone_floor_06 cobblestone_floor_07 cobblestone_floor_08 cobblestone_floor_09 cobblestone_floor_13 cobblestone_01 cobblestone_02 cobblestone_03 cobblestone_05 cobblestone_pavement cobblestone_square patterned_cobblestone patterned_cobblestone_02 mossy_cobblestone square_cobblestone floor_pattern_01 floor_pattern_02 stone_floor brick_pavement',
 'asphalt': 'asphalt_01 asphalt_02 asphalt_03 asphalt_04 asphalt_05 asphalt_06 asphalt_07 clean_asphalt worn_asphalt road_damaged road_damaged_2 aerial_asphalt_01 cobblestone_embedded_asphalt asphalt_floor',
 'paving': 'concrete_pavement concrete_pavement_02 concrete_pavement_03 pavement_01 pavement_02 pavement_03 pavement_04 pavement_05 pavement_06 precast_stone_paving stone_pavers rectangular_paving square_concrete_pavers interlocking_concrete_pavers slate_floor slate_driveway herringbone_pavement red_brick_pavers square_pavers worn_patterned_pavers patterned_paving',
 'concrete': 'concrete_wall_001 concrete_wall_003 concrete_wall_004 concrete_wall_006 concrete_wall_007 concrete_wall_009 concrete worn_concrete_floor cracked_concrete concrete_floor_worn_001 brushed_concrete scuffed_cement',
 'plaster': 'beige_wall_001 beige_wall_002 grey_plaster grey_plaster_02 grey_plaster_03 white_plaster_02 white_rough_plaster white_plaster_rough_01 yellow_plaster yellow_plaster_02 blue_plaster_weathered red_plaster_weathered painted_plaster_wall plastered_wall plastered_wall_02 plastered_wall_03 plastered_wall_04 white_stucco worn_plaster_wall worn_cracked_plaster worn_mossy_plasterwall clay_plaster peeling_painted_wall rough_plaster_brick_04',
 'roof_slate': 'grey_roof_tiles grey_roof_tiles_02 grey_roof_01 roof_slates_02 roof_slates_03 red_slate_roof_tiles_01 roof_planks',
 'roof_tile': 'clay_roof_tiles clay_roof_tiles_02 ceramic_roof_01 roof_tiles roof_tiles_14 roof_07 roof_09 roof_3',
 'roof_metal': 'bitumen box_profile_metal_sheet corrugated_iron corrugated_iron_02 worn_corrugated_iron',
 'wood': 'black_painted_planks blue_painted_planks distressed_painted_planks green_rough_planks weathered_brown_planks weathered_planks weathered_plank_siding white_planks_clean wood_planks_dirt wood_planks_grey old_planks_02 dark_planks wood_peeling_paint_weathered wooden_rough_planks medieval_wood wooden_panels',
 'door': 'rough_pine_door wooden_gate wooden_garage_door wood_shutter worn_shutter painted_metal_shutter rusted_shutter rusty_metal_shutter',
 'metal': 'rust_coarse_01 rusty_metal rusty_metal_02 green_metal_rust metal_plate metal_plate_02 rusty_painted_metal rusty_metal_grid blue_metal_plate container_side',
 'ground': 'gravel_floor gravel_road gravel_ground_01 rocky_gravel rocky_trail forrest_ground_01 dry_ground_01 brown_mud brown_mud_02 brown_mud_leaves_01 mud_forest park_dirt dirt raked_dirt stony_dirt_path dry_decay_leaves forest_leaves_02 winter_leaves grass_ground leafy_grass sparse_grass withered_grass aerial_grass_rock gravelly_sand grass_path_2',
 'snow': 'snow_01 snow_02 snow_03 snow_04 snow_05 snow_floor',
 'rock_cliff': 'cliff_side rock_face rock_face_03 rock_wall_03 rock_wall_05 rock_wall_13 mossy_rock rock_boulder_dry gray_rocks dark_rock rock_pitted_mossy lichen_rock rock_surface',
}
PH_HERO = set('medieval_blocks_05 old_stone_wall cobblestone_floor_03 cobblestone_floor_04 brick_wall_006'.split())
def acg(): return [(k, i) for k, v in ACG.items() for i in v.split()]
def ph(): return [(k, i) for k, v in PH.items() for i in v.split()]
if __name__ == '__main__':
    a, p = acg(), ph(); print(len(a), len(p), len(set(i.lower() for _, i in a) & set(i for _, i in p)))
