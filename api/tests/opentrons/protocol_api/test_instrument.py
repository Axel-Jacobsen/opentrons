""" Test the InstrumentContext class and its functions """
import pytest
from unittest import mock
import opentrons.protocol_api as papi
from opentrons.protocol_api.labware import Well
from opentrons.protocols.advanced_control import transfers
from opentrons.protocols.geometry.well_geometry import WellGeometry
from opentrons.protocols.implementations.well import WellImplementation
from opentrons.types import Mount, Point
from opentrons.protocols.types import APIVersion


@pytest.fixture
def make_context_and_labware():
    def _make_context_and_labware(api_version):
        ctx = papi.ProtocolContext(api_version=api_version)
        lw1 = ctx.load_labware('biorad_96_wellplate_200ul_pcr', 1)
        instr = ctx.load_instrument('p300_single', Mount.RIGHT)

        return {'ctx': ctx, 'instr': instr, 'lw1': lw1}

    return _make_context_and_labware


@pytest.mark.parametrize(
    'liquid_handling_command',
    ['transfer', 'consolidate', 'distribute'])
def test_blowout_location_unsupported_version(
        make_context_and_labware, liquid_handling_command):
    # not supported in versions below 2.8
    context_and_labware = make_context_and_labware(APIVersion(2, 7))
    context_and_labware['ctx'].home()
    lw1 = context_and_labware['lw1']
    instr = context_and_labware['instr']
    with pytest.raises(
            ValueError,
            match='Cannot specify blowout location when using api version ' +
            'below 2.8, current version is 2.7'):
        getattr(instr, liquid_handling_command)(
            100,
            lw1['A1'],
            lw1['A2'],
            blowout_location='should not matter')


@pytest.mark.parametrize(
    argnames='liquid_handling_command,'
             'blowout_location,'
             'expected_error_match,',
    argvalues=[
        [
            'transfer',
            'some invalid location',
            'blowout location should be either'
        ],
        [
            'consolidate',
            'source well',
            'blowout location for consolidate cannot be source well'
        ],
        [
            'distribute',
            'destination well',
            'blowout location for distribute cannot be destination well'
        ],
    ]
)
def test_blowout_location_invalid(
        make_context_and_labware,
        liquid_handling_command,
        blowout_location,
        expected_error_match):
    context_and_labware = make_context_and_labware(APIVersion(2, 8))
    context_and_labware['ctx'].home()
    lw1 = context_and_labware['lw1']
    instr = context_and_labware['instr']
    with pytest.raises(ValueError, match=expected_error_match):

        getattr(instr, liquid_handling_command)(
            100,
            lw1['A1'],
            lw1['A2'],
            blowout_location=blowout_location)


@pytest.mark.parametrize(
    argnames='liquid_handling_command,'
             'blowout_location,'
             'expected_strat,',
    argvalues=[
        ['transfer', 'destination well', transfers.BlowOutStrategy.DEST],
        ['transfer', 'source well', transfers.BlowOutStrategy.SOURCE],
        ['transfer', 'trash', transfers.BlowOutStrategy.TRASH],
        ['consolidate', 'destination well', transfers.BlowOutStrategy.DEST],
        ['consolidate', 'trash', transfers.BlowOutStrategy.TRASH],
        ['distribute', 'source well', transfers.BlowOutStrategy.SOURCE],
        ['distribute', 'trash', transfers.BlowOutStrategy.TRASH],
    ]
)
def test_valid_blowout_location(
        make_context_and_labware,
        liquid_handling_command,
        blowout_location,
        expected_strat):
    context_and_labware = make_context_and_labware(APIVersion(2, 8))
    context_and_labware['ctx'].home()
    lw1 = context_and_labware['lw1']
    instr = context_and_labware['instr']

    with mock.patch.object(
            papi.InstrumentContext, '_execute_transfer') as patch:
        getattr(instr, liquid_handling_command)(
            100,
            lw1['A2'],
            [lw1['A1'], lw1['B1']],
            blow_out=True,
            blowout_location=blowout_location,
            new_tip='never'
        )
        blowout_strat = patch.call_args[0][0]._options.transfer \
            .blow_out_strategy

        assert blowout_strat == expected_strat


@pytest.mark.parametrize(argnames=["api_version", "expected_point"],
                         argvalues=[
                             # Above version_breakpoint:
                             #  subtract return_height (0.5) * tip_length (1)
                             #  from z (15)
                             [APIVersion(2, 3), Point(10, 10, 14.5)],
                             # Below version_breakpoint:
                             #  add 10 to bottom (10)
                             [APIVersion(2, 0), Point(10, 10, 20)],
                         ])
def test_determine_drop_target(
        make_context_and_labware,
        api_version,
        expected_point):
    fixture = make_context_and_labware(api_version)
    lw_mock = fixture['lw1']
    lw_mock._implementation.is_tiprack = mock.MagicMock(return_value=True)
    lw_mock._implementation.get_tip_length = mock.MagicMock(return_value=1)
    well = Well(
        well_implementation=WellImplementation(
            well_geometry=WellGeometry(
                well_props={
                    'shape': 'circular',
                    'depth': 5,
                    'totalLiquidVolume': 0,
                    'x': 10,
                    'y': 10,
                    'z': 10,
                    'diameter': 5,
                },
                parent_point=Point(0, 0, 0),
                parent_object=lw_mock._implementation),
            display_name="",
            has_tip=False,
            name="A1",
        ),
        api_level=api_version
    )
    r = fixture['instr']._determine_drop_target(well)
    assert r.labware.object == well
    assert r.point == expected_point
