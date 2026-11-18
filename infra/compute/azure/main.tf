# Selva's Rhino.Compute VM on Azure: the same server as ../gcp, deployed the same way. Runbook: README.md.
# Every name carries var.name so it can share a subscription with another Compute server.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
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
  description = "Prefix of every resource, the ssh alias, and the DNS label: <name>.<location>.cloudapp.azure.com"
  type        = string
  default     = "selva-compute-az"
}

variable "location" {
  description = "Azure region; swedencentral was the cheapest EU region for 4 cores in 2026-11"
  type        = string
  default     = "swedencentral"
}

# v4: new subscriptions get no Dsv5 quota, and v6 needs an NVMe disk controller.
variable "vm_size" {
  description = "Must be x86: McNeel's arm64 Rhino packages lag months behind. Rhino bills per vCPU while a child runs."
  type        = string
  default     = "Standard_D4s_v4"
}

variable "ssh_public_key_path" {
  description = "Public key installed for the deploy user"
  type        = string
  default     = "~/.ssh/google_compute_engine.pub"
}

variable "ssh_public_keys" {
  description = "Every deploy machine's public key, so an apply from one machine doesn't revoke another's."
  type        = list(string)
  default     = []
}

variable "ssh_allowed_ips" {
  description = "CIDRs allowed to reach SSH"
  type        = list(string)
}

variable "compute_client_ips" {
  description = "CIDRs allowed on port 6500. Anything listed talks plain HTTP over the internet."
  type        = list(string)
  default     = []
}

variable "public_https" {
  description = "Open 80 and 443 to everyone for the HTTPS proxy deploy-server.sh runs when DEPLOY_TLS_DOMAIN is set (80 answers Let's Encrypt's challenge)"
  type        = bool
  default     = true
}

locals {
  # Sorted so every machine renders the same keys and a plan shows no drift.
  ssh_keys = sort(distinct(concat(
    [trimspace(file(pathexpand(var.ssh_public_key_path)))],
    [for k in var.ssh_public_keys : trimspace(k)]
  )))
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
    name                       = "ssh"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefixes    = var.ssh_allowed_ips
    destination_address_prefix = "*"
  }

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
    for_each = length(var.compute_client_ips) > 0 ? [1] : []
    content {
      name                       = "compute-clients"
      priority                   = 120
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = "6500"
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

# No managed identity: the VM runs third-party plugins and needs no Azure API.
resource "azurerm_linux_virtual_machine" "compute" {
  name                  = "${var.name}-vm"
  location              = var.location
  resource_group_name   = azurerm_resource_group.compute.name
  size                  = var.vm_size
  network_interface_ids = [azurerm_network_interface.compute.id]
  tags                  = { owner = "selva" }

  # With passwords off, the Azure agent gives this user passwordless sudo, which deploy-server.sh
  # needs to install Docker on the first deploy.
  admin_username                  = "deploy"
  disable_password_authentication = true
  dynamic "admin_ssh_key" {
    for_each = local.ssh_keys
    content {
      username   = "deploy"
      public_key = admin_ssh_key.value
    }
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 64
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}

output "ssh_config" {
  description = "Add to ~/.ssh/config, then DEPLOY_HOST=<name> in .env"
  value       = <<-EOT
    Host ${var.name}
      HostName ${azurerm_public_ip.compute.ip_address}
      User deploy
      IdentityFile ${trimsuffix(pathexpand(var.ssh_public_key_path), ".pub")}
  EOT
}

output "tls_domain" {
  description = "DEPLOY_TLS_DOMAIN in .env"
  value       = azurerm_public_ip.compute.fqdn
}

output "public_url" {
  description = "Rhino.Compute URL for the clients in compute_client_ips"
  value       = "http://${azurerm_public_ip.compute.ip_address}:6500"
}
