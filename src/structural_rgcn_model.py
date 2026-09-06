import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import RGCNConv


class StructuralRGCNDDIModel(nn.Module):
    """
    Exploratory structural-feature-only R-GCN for DDI prediction.

    Input features:
        15 standardized log1p outgoing relation-degree features
        + 3 node-type one-hot features

    No learned node-ID embedding is used.
    """

    def __init__(
        self,
        input_dim=18,
        hidden_dim=128,
        num_relations=15,
        dropout=0.2,
    ):
        super().__init__()

        self.conv1 = RGCNConv(
            input_dim,
            hidden_dim,
            num_relations
        )

        self.conv2 = RGCNConv(
            hidden_dim,
            hidden_dim,
            num_relations
        )

        self.dropout = dropout

        self.ddi_relation = nn.Parameter(
            torch.empty(hidden_dim)
        )

        self.reset_parameters()


    def reset_parameters(self):

        self.conv1.reset_parameters()
        self.conv2.reset_parameters()

        nn.init.ones_(
            self.ddi_relation
        )


    def encode(
        self,
        structural_features,
        edge_index,
        edge_type
    ):

        x = self.conv1(
            structural_features,
            edge_index,
            edge_type
        )

        x = F.relu(x)

        x = F.dropout(
            x,
            p=self.dropout,
            training=self.training
        )

        x = self.conv2(
            x,
            edge_index,
            edge_type
        )

        return x


    def decode(
        self,
        z,
        pair_index
    ):

        src = pair_index[0]
        dst = pair_index[1]

        return (
            z[src]
            * self.ddi_relation
            * z[dst]
        ).sum(dim=-1)