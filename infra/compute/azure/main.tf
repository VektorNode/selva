# A Windows Rhino.Compute server on Azure, for definitions that need Windows-only Grasshopper plugins.
# Runbook: README.md. Every name carries var.name so it can share a subscription with another server.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

variable "subscription_id" {
  description = "az account show --query id -o tsv"
  type        = string
}

variable "name" {
  description = "Prefix of every resource, and the DNS label: <name>.<location>.cloudapp.azure.com"
  type        = string
  default     = "selva-compute-win"
}

variable "location" {
  description = "Azure region; swedencentral was the cheapest EU region for a 4-core Windows VM in 2026-11"
  type        = string
  default     = "swedencentral"
}

variable "vm_size" {
  # v4: new subscriptions get no Dsv5 quota, and v6 needs an NVMe disk controller.
  description = "Rhino bills per core hour while a child runs, so more cores cost twice"
  type        = string
  default     = "Standard_D4s_v4"
}

variable "rdp_allowed_ips" {
  description = "CIDRs allowed to RDP in, e.g. [\"203.0.113.7/32\"]"
  type        = list(string)
}

variable "public_https" {
  description = "Open 80 and 443 to everyone for the Let's Encrypt certificate setup.ps1 installs. false leaves only compute_client_ips on plain HTTP 80."
  type        = bool
  default     = true
}

variable "compute_client_ips" {
  description = "CIDRs allowed on plain HTTP port 80 when public_https is false"
  type        = list(string)
  default     = []
}

resource "random_password" "admin" {
  length           = 24
  special          = true
  override_special = "!#%*-_=+"
}

resource "random_string" "storage_suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "compute" {
  name     = "${var.name}-rg"
  location = var.location
  tags     = { owner = "selva" }
}

resource "azurerm_virtual_network" "compute" {
  name                = "${var.name}-vnet"
  location            = var.location
  resource_group_name = azurerm_resource_group.compute.name
  address_space       = ["10.40.0.0/16"]
}

resource "azurerm_subnet" "compute" {
  name                 = "${var.name}-subnet"
  resource_group_name  = azurerm_resource_group.compute.name
  virtual_network_name = azurerm_virtual_network.compute.name
  address_prefixes     = ["10.40.1.0/24"]
}

resource "azurerm_public_ip" "compute" {
  name                = "${var.name}-ip"
  location            = var.location
  resource_group_name = azurerm_resource_group.compute.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.name
}

resource "azurerm_network_security_group" "compute" {
  name                = "${var.name}-nsg"
  location            = var.location
  resource_group_name = azurerm_resource_group.compute.name

  security_rule {
    name                       = "rdp"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefixes    = var.rdp_allowed_ips
    destination_address_prefix = "*"
  }

  # Port 80 stays open with HTTPS on: Let's Encrypt renewals answer on it.
  dynamic "security_rule" {
    for_each = var.public_https ? [1] : []
    content {
      name                       = "https"
      priority                   = 110
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_ranges    = ["80", "443"]
      source_address_prefix      = "Internet"
      destination_address_prefix = "*"
    }
  }

  dynamic "security_rule" {
    for_each = !var.public_https && length(var.compute_client_ips) > 0 ? [1] : []
    content {
      name                       = "compute-clients"
      priority                   = 120
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = "80"
      source_address_prefixes    = var.compute_client_ips
      destination_address_prefix = "*"
    }
  }
}

resource "azurerm_network_interface" "compute" {
  name                = "${var.name}-nic"
  location            = var.location
  resource_group_name = azurerm_resource_group.compute.name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.compute.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.compute.id
  }
}

resource "azurerm_network_interface_security_group_association" "compute" {
  network_interface_id      = azurerm_network_interface.compute.id
  network_security_group_id = azurerm_network_security_group.compute.id
}

resource "azurerm_windows_virtual_machine" "compute" {
  # Windows computer names are capped at 15 characters.
  name                  = "${var.name}-vm"
  computer_name         = substr(replace(var.name, "-", ""), 0, 15)
  location              = var.location
  resource_group_name   = azurerm_resource_group.compute.name
  size                  = var.vm_size
  admin_username        = "selvaadmin"
  admin_password        = random_password.admin.result
  network_interface_ids = [azurerm_network_interface.compute.id]
  tags                  = { owner = "selva" }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 128
  }

  source_image_reference {
    publisher = "MicrosoftWindowsServer"
    offer     = "WindowsServer"
    sku       = "2022-datacenter-azure-edition"
    version   = "latest"
  }
}

# Holds what deploy.ps1 hands the VM: setup.ps1, plugins.json and the local plugin files.
resource "azurerm_storage_account" "setup" {
  name                            = "${substr(replace(var.name, "-", ""), 0, 18)}${random_string.storage_suffix.result}"
  location                        = var.location
  resource_group_name             = azurerm_resource_group.compute.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_container" "setup" {
  name                  = "setup"
  storage_account_id    = azurerm_storage_account.setup.id
  container_access_type = "private"
}

output "resource_group" {
  value = azurerm_resource_group.compute.name
}

output "vm_name" {
  value = azurerm_windows_virtual_machine.compute.name
}

output "storage_account" {
  value = azurerm_storage_account.setup.name
}

output "fqdn" {
  description = "setup.ps1 requests the certificate for this name"
  value       = azurerm_public_ip.compute.fqdn
}

output "compute_url" {
  description = "Rhino.Compute URL for Selva's Compute settings"
  value       = var.public_https ? "https://${azurerm_public_ip.compute.fqdn}" : "http://${azurerm_public_ip.compute.ip_address}"
}

output "rdp" {
  value = "mstsc /v:${azurerm_public_ip.compute.ip_address}  (user selvaadmin, password: terraform output -raw admin_password)"
}

output "admin_password" {
  value     = random_password.admin.result
  sensitive = true
}
