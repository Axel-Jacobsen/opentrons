# opentrons api makefile

include ../scripts/push.mk
include ../scripts/python.mk

# using bash instead of /bin/bash in SHELL prevents macOS optimizing away our PATH update
SHELL := bash

# add yarn CLI dev deps to PATH (for cross platform POSIX commands via shx)
# and also make an explicit version for shx for use in the shell function,
# where PATH won’t be propagated
PATH := $(shell cd .. && yarn bin):$(PATH)
SHX := npx shx

# make push wheel file (= rather than := to expand at every use)
firmware = $(wildcard smoothie/*.hex)

# python and pipenv config
sphinx_build := $(pipenv) run sphinx-build


# Find the version of the wheel from package.json using a helper script. We
# use python here so we can use the same version normalization that will be
# used to create the wheel.
wheel_file = dist/$(call python_get_wheelname,api,opentrons,$(BUILD_NUMBER))

# These variables are for simulating python protocols
sim_log_level ?= info
simfile ?=

# These variables can be overriden when make is invoked to customize the
# behavior of pytest. For instance,
# make test tests=tests/opentrons/tools/test_qc_scripts.py would run only the
# specified test
tests ?= tests
test_opts ?=  --cov=src/opentrons --cov-report term-missing:skip-covered --cov-report xml:coverage.xml

# These variables must be overridden when make deploy or make deploy-staging is run
# to set the auth details for pypi
pypi_username ?=
pypi_password ?=

# Host key location for buildroot robot
br_ssh_key ?= $(default_ssh_key)
# Other SSH args for buildroot robots
ssh_opts ?= $(default_ssh_opts)

twine_auth_args := --username $(pypi_username) --password $(pypi_password)
twine_repository_url ?= $(pypi_test_upload_url)

# Source discovery
# For the python sources
ot_py_sources := $(filter %.py,$(shell $(SHX) find src/opentrons/))
# And the out of tree shared data
ot_shared_data_sources := $(filter %.json,$(shell $(SHX) find ../shared-data/))
# And the arbitrary stuff in resources
ot_resources := $(filter %,$(shell $(SHX) find src/opentrons/resources))
ot_sources := $(ot_py_sources) $(ot_shared_data_sources) $(ot_resources)

ot_tests_to_typecheck := tests/opentrons/protocol_engine tests/opentrons/motion_planning

# Defined separately than the clean target so the wheel file doesn’t have to
# depend on a PHONY target
clean_cmd = $(SHX) rm -rf build dist .coverage coverage.xml '*.egg-info' '**/__pycache__' '**/*.pyc' 'src/**/.mypy_cache'

plot_type ?=

.PHONY: all
all: clean wheel

.PHONY: setup
setup:
	$(pipenv) sync $(pipenv_opts)
	$(pipenv) run pip freeze

.PHONY: clean
clean: docs-clean
	$(clean_cmd)

.PHONY: teardown
teardown:
	$(pipenv) --rm

dist/opentrons-%-py2.py3-none-any.whl: setup.py $(ot_sources)
	$(clean_cmd)
	$(python) setup.py $(wheel_opts) bdist_wheel
	$(SHX) rm -rf build
	$(SHX) ls dist

wheel: $(wheel_file)

.PHONY: test
test:
	$(pytest) $(tests) $(test_opts)

.PHONY: lint
lint: $(ot_py_sources)
	$(python) -m mypy src/opentrons $(ot_tests_to_typecheck)
	$(python) -m flake8 setup.py src/opentrons tests

docs/build/html/v%: docs/v%
	$(sphinx_build) -b html -d docs/build/doctrees -n $< $@
	$(SHX) cp docs/img/lightbulb.jpg $@/_images/ # sphinx wont automatically do this because it's only in a template

docs/build/pdf/OpentronsPythonAPIV%.pdf: docs/v%
	$(sphinx_build) -b latex -d docs/build/doctrees $< $(@D)
	$(MAKE) -C $(@D) all-pdf $(if $(CI),>/dev/null,|| $(SHX) echo "latex build failed (pdflatex not installed?)")
	$(SHX) ls $(@D)/*.pdf $(if $(CI),,|| $(SHX) echo "no pdf produced")

docs/dist/v%: docs/build/html/v% docs/build/pdf/OpentronsPythonAPIV%.pdf
	$(SHX) mkdir -p $@
	$(SHX) cp -R $^ $(@D) $(if $(CI),,|| true)

docs/dist/ot1: docs/ot1
	$(SHX) mkdir -p $@
	$(SHX) cp -R $< $(@D)

docs/dist/%: docs/root/%
	$(SHX) mkdir -p $(@D)
	$(SHX) cp -R docs/root/* docs/dist/

.PHONY: docs
docs: docs/dist/index.html docs/dist/v1 docs/dist/v2 docs/dist/ot1

.PHONY: docs-clean
docs-clean:
	$(SHX) rm -rf docs/dist docs/build

.PHONY: dev
dev:
	echo "Command will be deprecated. Use \"make -C robot-server dev\""
	$(MAKE) -C ../robot-server dev

.PHONY: local-shell
local-shell:
	$(pipenv) shell

.PHONY: push-no-restart
push-no-restart: wheel
	$(call push-python-package,$(host),$(br_ssh_key),$(ssh_opts),$(wheel_file))

.PHONY: push
push: push-no-restart
	$(call restart-service,$(host),$(br_ssh_key),$(ssh_opts),"jupyter-notebook opentrons-robot-server")

.PHONY: simulate
simulate:
	-$(python) -m opentrons.simulate -l $(sim_log_level) $(simfile)

.PHONY: deploy
deploy: wheel
	$(call python_upload_package,$(twine_auth_args),$(twine_repository_url),$(wheel_file))

# User must currently specify host, e.g.: `make term host=169.254.202.176`
.PHONY: term
term:
	ssh -i $(br_ssh_key) $(ssh_opts) root@$(host)

.PHONY: plot-session
plot-session:
	$(python) util/plot_session.py $(plot_type) $(plot_type).pdf
